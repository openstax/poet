import vscode from 'vscode'
import { LanguageClient } from 'vscode-languageclient/node'
import { BooksAndOrphans } from '../../common/src/requests'
import { PanelStateMessageType, PanelStateMessage } from '../../common/src/webview-constants'
import { ensureCatchPromise, genNonce, injectCspNonce } from './utils'

// Modified from https://github.com/microsoft/vscode/blob/main/extensions/markdown-language-features/src/util/dispose.ts
/**
 * A basic implementer of `DisposableSupplemental`, meant to be delegated to
 * by more complex implementers of `DisposableSupplemental`.
 */
export class Disposer implements DisposableSupplemental {
  private _disposed = false
  private registeredDisposables: Disposable[] = []
  private readonly _onDidDispose: vscode.EventEmitter<void> = new vscode.EventEmitter()

  readonly onDidDispose: vscode.Event<void> = (...args) => {
    return this._onDidDispose.event(...args)
  }

  /**
   * Disposes all child disposables
   */
  private disposeAll(): void {
    for (const disposable of this.registeredDisposables) {
      disposable.dispose()
    }
    this.registeredDisposables = []
  }

  dispose(): void {
    if (this._disposed) {
      return
    }
    this._disposed = true
    this._onDidDispose.fire()
    this.disposeAll()
  }

  registerDisposable<T extends Disposable>(value: T): T {
    if (this.disposed()) {
      value.dispose()
    } else {
      this.registeredDisposables.push(value)
    }
    return value
  }

  disposed(): boolean {
    return this._disposed
  }
}

/**
 * An abstract class to be inherited by webview panel components.
 *
 * Should greedily create an internal panel during construction. Implementers
 * may include extra fields and disposables bound to each instance of
 * inheriting types to create unique behaviors. Instances of inheriting types
 * will have a two-way disposal binding with the internal panel, i.e. if the
 * internal panel is disposed, this item will be disposed as a result, or if
 * this item is disposed, the internal panel will be disposed as a result.
 *
 * Inheriting types must specify generic parameters representing the types of
 * messages that are sent back and forth between the internal panel and the
 * host. `InMessage` is the type of messages sent from the internal webview
 * panel to the host. `OutMessage` is the type of messages sent from the host
 * to the internal webview panel.
 */
export abstract class Panel<InMessage, OutMessage, State> implements DisposableSupplemental, Messageable<InMessage, OutMessage> {
  protected readonly panel: vscode.WebviewPanel
  protected nonce: string
  private readonly disposer: DisposableSupplemental

  constructor(innerPanel: vscode.WebviewPanel) {
    this.disposer = new Disposer()
    this.panel = innerPanel
    this.nonce = genNonce()
    this.registerDisposable(this.panel)
    this.panel.onDidDispose(() => this.dispose())

    this.registerDisposable(this.panel.webview.onDidReceiveMessage((message) => {
      /* istanbul ignore if */
      if (message.type === PanelStateMessageType.Request) {
        void ensureCatchPromise(this.sendState())
      } else {
        void ensureCatchPromise(this.handleMessage(message))
      }
    }))
  }

  /**
   * Returns whether the internal panel is visible
   */
  visible(): boolean {
    return this.panel.visible
  }

  /**
   * Handle a message sent to the host from the internal webview panel
   */
  abstract handleMessage(message: InMessage): Promise<void>
  protected abstract getState(): State

  /**
   * Send a message from the host to the internal webview panel
   */
  async postMessage(message: OutMessage | PanelStateMessage<State>): Promise<void> {
    if (this.disposed()) {
      return
    }
    await this.panel.webview.postMessage(message)
  }

  async sendState(): Promise<void> {
    await this.postMessage({ type: PanelStateMessageType.Response, state: this.getState() })
  }

  /**
   * Inject initial state into an html string to ensure that the document load does not race with message receival
   * @param html an html string which must: a) contain a single body element, and b) load js that listens for and handles a 'message' event by the time the document is loaded
   * @param state the initial state to give the document upon loading
   * @returns the same html but with the state inlined that will automatially replay on load
   */
  injectInitialState(html: string, state: State): string {
    const injection = `
    <script nonce="${this.nonce}">
      (() => {
        let fireInjectedEvents = () => {
          let state = { type: ${JSON.stringify(PanelStateMessageType.Response)}, state: /* rest is injected */ ${JSON.stringify(state)} };
          console.debug('[ENSURED_STATE_DEBUG] loading pickled initial state:', state);
          let event = new CustomEvent('message');
          event.data = state;
          window.dispatchEvent(event);
          window.removeEventListener('load', fireInjectedEvents);

          // Ask for any updates to the state since this HTML was pickled.
          // This also allows the extension to know that the webview has loaded.
          const vscode = acquireVsCodeApi()
          vscode.postMessage({ type: ${JSON.stringify(PanelStateMessageType.Request)} })
          
          // vscode only allows calling acquireVsCodeApi once.
          // Since we called it we will redefine the function so it does not error.
          window.acquireVsCodeApi = () => vscode
        };
        window.addEventListener('load', fireInjectedEvents);
      })()
    </script>`
    html = html.replace('</body>', `</body>${injection}`)
    html = injectCspNonce(html, this.nonce)
    return html
  }

  readonly reveal: Panel<InMessage, OutMessage, State>['panel']['reveal'] = (...args) => {
    return this.panel.reveal(...args)
  }

  readonly onDidDispose: Panel<InMessage, OutMessage, State>['disposer']['onDidDispose'] = (...args) => {
    return this.disposer.onDidDispose(...args)
  }

  readonly dispose: Panel<InMessage, OutMessage, State>['disposer']['dispose'] = (...args) => {
    return this.disposer.dispose(...args)
  }

  readonly registerDisposable: Panel<InMessage, OutMessage, State>['disposer']['registerDisposable'] = (...args) => {
    return this.disposer.registerDisposable(...args)
  }

  readonly disposed: Panel<InMessage, OutMessage, State>['disposer']['disposed'] = (...args) => {
    return this.disposer.disposed(...args)
  }
}

/**
 * Implementers handle incoming and outgoing messages from the extension.
 * `IncomingMessage` is the type of messages sent to the implementer.
 * `OutgoingMessage` is the type of messages sent from the implementer.
 */
interface Messageable<IncomingMessage, OutgoingMessage> {
  /**
   * Handle a message sent to this object
   */
  handleMessage: (message: IncomingMessage) => Promise<void>
  /**
   * Send a message from this object to a predetermined location
   */
  postMessage: (message: OutgoingMessage) => Promise<void>
}

/**
 * Represents a type which can release resources, such as event listening or a
 * timer. Methods called on an implementer that is disposed or any of its
 * children disposables should not perform any actions other than potentially
 * throwing.
 */
interface Disposable {
  /**
   * Dispose this item and all children disposables. If already disposed,
   * do nothing
   */
  dispose: () => void
}

/**
 * Supplemental methods beyond what is provided by the vscode.Disposable type
 */
interface DisposableSupplemental extends Disposable {
  /**
   * Event fired when the panel is disposed.
   */
  onDidDispose: (listener: () => void) => void
  /**
   * Register a child disposable with this disposable. Whenever this item is
   * disposed, its children, too, are disposed and all onDidDispose events
   * should fire.
   */
  registerDisposable: <T extends Disposable>(value: T) => T
  /**
   * Returns whether or not this item has been disposed
   */
  disposed: () => boolean
}

/**
 * Part of the extension host context that can be used for listening to events
 * that derive from language server requests. Technically this is a workaround
 * for the fact that a LanguageClient's `onRequest` only allows a single
 * handler. To allow multiple extension components to listen to these language
 * server events, we the single handler to fire events in the Event system.
 */
export interface ExtensionEvents {
  onDidChangeWatchedFiles: vscode.Event<void>
}

/**
 * Extension host context provided to different extension components, such as
 * webview panels or tree views. Should provide all the context necessary for
 * each component to listen to events and provide their services independently
 * of one another
 */
export interface ExtensionHostContext {
  resourceRootDir: string
  client: LanguageClient
  events: ExtensionEvents
  bookTocs: BooksAndOrphans
}

/**
 * Manages the creation, disposing, and revealing of an single instance of an
 * unknown type of webview panel. Meant to be used in the extension base to
 * disassociate registered commands from the concerns of panel state.
 */
export class PanelManager<T extends Panel<unknown, unknown, unknown>> {
  private _panel: T | null = null

  constructor(
    private readonly context: ExtensionHostContext,
    private readonly PanelClass: new (context: ExtensionHostContext) => T
  ) {}

  /**
   * Create and reveal a new panel of the unknown managed type. If a panel
   * is already being managed, dispose it before creating a new one.
   */
  newPanel(): T {
    if (this._panel != null) {
      this._panel.dispose()
    }
    const p = new this.PanelClass(this.context)
    this._panel = p
    return p
  }

  /**
   * Reveal a panel of the unknown managed type. If a panel
   * is not already being managed, create a new one.
   */
  revealOrNew(): T {
    const p = this._panel
    if (p != null && !p.disposed()) {
      p.reveal()
      return p
    }
    return this.newPanel()
  }

  /**
   * Returns the currently managed panel, or `null` if none is being managed
   */
  panel(): T | null {
    return this._panel
  }
}
