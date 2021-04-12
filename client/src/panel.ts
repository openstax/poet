import vscode from 'vscode'
import { LanguageClient } from 'vscode-languageclient/node'

// Modified from https://github.com/microsoft/vscode/blob/main/extensions/markdown-language-features/src/util/dispose.ts
class Disposer implements Disposable {
  private _disposed = false
  private registeredDisposables: vscode.Disposable[] = [] // TODO: change type to Disposable[]
  private onDidDisposeListeners: Array<() => void> = []

  onDidDispose(listener: () => void): void {
    this.onDidDisposeListeners.push(listener)
  }

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
    for (const listener of this.onDidDisposeListeners) {
      listener()
    }
    this.onDidDisposeListeners = []
    this.disposeAll()
  }

  registerDisposable<T extends vscode.Disposable>(value: T): T {
    if (this._disposed) {
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

export abstract class Panel<InMessage, OutMessage> implements Disposable, Messageable<InMessage, OutMessage> {
  protected readonly panel: vscode.WebviewPanel
  private readonly disposer: Disposable

  constructor(initPanel: () => vscode.WebviewPanel) {
    this.disposer = new Disposer()
    this.panel = initPanel()
    this.registerDisposable(this.panel)
    this.panel.onDidDispose(() => this.dispose())

    // FIXME: Dispose this
    this.panel.webview.onDidReceiveMessage((message) => {
      this.handleMessage(message).catch((err: Error) => {
        void vscode.window.showErrorMessage(err.message)
        throw err
      })
    })
  }

  abstract handleMessage(message: InMessage): Promise<void>
  async postMessage(message: OutMessage): Promise<void> {
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

interface Messageable<IncomingMessage, OutgoingMessage> {
  handleMessage: (message: IncomingMessage) => Promise<void>
  postMessage: (message: OutgoingMessage) => Promise<void>
}

interface Disposable {
  onDidDispose: (listener: () => void) => void
  dispose: () => void
  registerDisposable: <T extends vscode.Disposable>(value: T) => T
  disposed: () => boolean
}

export interface ExtensionHostContext {
  resourceRootDir: string
  client: LanguageClient
}

export class PanelManager<T extends Panel<unknown, unknown>> {
  private _panel: T | null = null

  constructor(
    private readonly context: ExtensionHostContext,
    private readonly PanelClass: new (context: ExtensionHostContext) => T
  ) {}

  newPanel(): void {
    if (this._panel != null) {
      this._panel.dispose()
    }
    this._panel = new this.PanelClass(this.context)
  }

  revealOrNew(): void {
    if (this._panel != null && !this._panel.disposed()) {
      this._panel.reveal()
      return
    }
    this.newPanel()
  }

  panel(): T | null {
    return this._panel
  }
}
