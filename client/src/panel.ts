import vscode from 'vscode'
import { LanguageClient } from 'vscode-languageclient/node'
import { ensureCatchPromise } from './utils'

// Modified from https://github.com/microsoft/vscode/blob/main/extensions/markdown-language-features/src/util/dispose.ts
export class Disposer implements DisposableSupplemental {
  private _disposed = false
  private registeredDisposables: Disposable[] = []
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

  visible(): boolean {
    return this.panel.visible
  }

  abstract handleMessage(message: InMessage): Promise<void>
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

interface Messageable<IncomingMessage, OutgoingMessage> {
  handleMessage: (message: IncomingMessage) => Promise<void>
  postMessage: (message: OutgoingMessage) => Promise<void>
}

interface Disposable {
  dispose: () => void
}

interface DisposableSupplemental extends Disposable {
  onDidDispose: (listener: () => void) => void
  registerDisposable: <T extends vscode.Disposable>(value: T) => T
  disposed: () => boolean
}

export interface ExtensionEvents {
  onDidChangeWatchedFiles: vscode.Event<undefined>
}

export interface ExtensionHostContext {
  resourceRootDir: string
  client: LanguageClient
  events: ExtensionEvents
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
