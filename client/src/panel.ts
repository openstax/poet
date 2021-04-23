import vscode from 'vscode'
import { LanguageClient } from 'vscode-languageclient/node'
import { ensureCatchPromise } from './utils'

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
export abstract class Panel<InMessage, OutMessage> implements DisposableSupplemental, Messageable<InMessage, OutMessage> {
  protected readonly panel: vscode.WebviewPanel
  private readonly disposer: DisposableSupplemental

  constructor(initPanel: () => vscode.WebviewPanel) {
    this.disposer = new Disposer()
    this.panel = initPanel()
    this.registerDisposable(this.panel)
    this.panel.onDidDispose(() => this.dispose())

    this.registerDisposable(this.panel.webview.onDidReceiveMessage((message) => {
      void ensureCatchPromise(this.handleMessage(message))
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
  /**
   * Send a message from the host to the internal webview panel
   */
  async postMessage(message: OutMessage): Promise<void> {
    if (this.disposed()) {
      return
    }
    await this.panel.webview.postMessage(message)
  }

  readonly reveal: Panel<InMessage, OutMessage>['panel']['reveal'] = (...args) => {
    return this.panel.reveal(...args)
  }

  readonly onDidDispose: Panel<InMessage, OutMessage>['disposer']['onDidDispose'] = (...args) => {
    return this.disposer.onDidDispose(...args)
  }

  readonly dispose: Panel<InMessage, OutMessage>['disposer']['dispose'] = (...args) => {
    return this.disposer.dispose(...args)
  }

  readonly registerDisposable: Panel<InMessage, OutMessage>['disposer']['registerDisposable'] = (...args) => {
    return this.disposer.registerDisposable(...args)
  }

  readonly disposed: Panel<InMessage, OutMessage>['disposer']['disposed'] = (...args) => {
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
}

/**
 * Manages the creation, disposing, and revealing of an single instance of an
 * unknown type of webview panel. Meant to be used in the extension base to
 * disassociate registered commands from the concerns of panel state.
 */
export class PanelManager<T extends Panel<unknown, unknown>> {
  private _panel: T | null = null

  constructor(
    private readonly context: ExtensionHostContext,
    private readonly PanelClass: new (context: ExtensionHostContext) => T
  ) {}

  /**
   * Create and reveal a new panel of the unknown managed type. If a panel
   * is already being managed, dispose it before creating a new one.
   */
  newPanel(): void {
    if (this._panel != null) {
      this._panel.dispose()
    }
    this._panel = new this.PanelClass(this.context)
  }

  /**
   * Reveal a panel of the unknown managed type. If a panel
   * is not already being managed, create a new one.
   */
  revealOrNew(): void {
    if (this._panel != null && !this._panel.disposed()) {
      this._panel.reveal()
      return
    }
    this.newPanel()
  }

  /**
   * Returns the currently managed panel, or `null` if none is being managed
   */
  panel(): T | null {
    return this._panel
  }
}
