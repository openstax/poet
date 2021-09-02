import vscode from 'vscode'
import fs from 'fs'
import path from 'path'
import { fixResourceReferences, fixCspSourceReferences, addBaseHref, expect, getRootPathUri, ensureCatchPromise, ensureCatch } from './utils'
import { PanelType } from './extension-types'
import { DOMParser, XMLSerializer } from 'xmldom'
import { ExtensionHostContext, Panel } from './panel'

// Line is one-indexed
export interface ScrollInEditorIncoming {
  type: 'scroll-in-editor'
  line: number
}

export interface DidReloadIncoming {
  type: 'did-reload'
}

export type PanelIncomingMessage = ScrollInEditorIncoming | DidReloadIncoming

export interface RefreshOutgoing {
  type: 'refresh'
  xml: string
  xsl: string
}

// Line is one-indexed
export interface ScrollToLineOutgoing {
  type: 'scroll-in-preview'
  line: number
}

export type PanelOutgoingMessage = (
  RefreshOutgoing
  | ScrollToLineOutgoing
)

const ELEMENT_NODE = 1
export const tagElementsWithLineNumbers = (doc: Document): void => {
  const root = doc.documentElement
  const stack: Element[] = [root]
  while (stack.length > 0) {
    const current = expect(stack.pop(), 'stack length is non-zero')
    current.setAttribute('data-line', (current as any).lineNumber)
    stack.push(...Array.from(current.childNodes).filter(node => node.nodeType === ELEMENT_NODE) as Element[])
  }
}

const initPanel = (context: ExtensionHostContext): vscode.WebviewPanel => {
  const editor = vscode.window.activeTextEditor
  const resourceColumn = editor?.viewColumn ?? vscode.ViewColumn.One
  const previewColumn = resourceColumn + 1
  const localResourceRoots = [vscode.Uri.file(context.resourceRootDir), expect(getRootPathUri(), 'workspace must be open to preview')]
  const panel = vscode.window.createWebviewPanel(
    PanelType.CNXML_PREVIEW,
    'CNXML Preview',
    previewColumn, {
      enableScripts: true,
      localResourceRoots,
      enableFindWidget: true
    }
  )
  panel.webview.html = rawTextHtml('Loading...')
  return panel
}

export const isXmlFile = (document: vscode.TextDocument): boolean => {
  return document.languageId === 'xml'
}

export const rawTextHtml = (text: string): string => {
  // Just to be safe...
  if (!/^[a-zA-Z0-9 ,.!]*$/.test(text)) {
    throw new Error('Must use simpler text for injection into HTML')
  }
  return `<html><body>${text}</body></html>`
}

export class CnxmlPreviewPanel extends Panel<PanelIncomingMessage, PanelOutgoingMessage> {
  private resourceBinding: vscode.Uri | null = null
  private webviewIsScrolling: boolean = false
  private resourceIsScrolling: boolean = false
  private xsl: string = ''
  private readonly _onDidChangeResourceBinding: vscode.EventEmitter<vscode.Uri | null>
  private readonly _onDidInnerPanelReload: vscode.EventEmitter<void>
  constructor(private readonly context: ExtensionHostContext) {
    super(initPanel(context))
    this._onDidChangeResourceBinding = new vscode.EventEmitter()
    this._onDidInnerPanelReload = new vscode.EventEmitter()
    void ensureCatchPromise(this.tryRebindToActiveResource(true))
    this.registerDisposable(vscode.window.onDidChangeActiveTextEditor((editor) => {
      void ensureCatchPromise(this.tryRebindToActiveResource(false))
    }))
    this.registerDisposable(this.context.events.onDidChangeWatchedFiles(ensureCatch(async () => {
      await this.tryRebindToActiveResource(false)
    })))
    this.registerDisposable(vscode.window.onDidChangeTextEditorVisibleRanges(event => {
      void ensureCatchPromise(this.tryScrollToRangeStartOfEditor(event.textEditor))
    }))
  }

  readonly onDidChangeResourceBinding: vscode.Event<vscode.Uri | null> = (...args) => {
    return this._onDidChangeResourceBinding.event(...args)
  }

  async handleMessage(message: PanelIncomingMessage): Promise<void> {
    if (message.type === 'scroll-in-editor') {
      for (const editor of vscode.window.visibleTextEditors) {
        if (!this.isPreviewOf(editor.document.uri)) {
          continue
        }
        if (this.resourceIsScrolling) {
          this.resourceIsScrolling = false
          return
        }
        this.webviewIsScrolling = true
        const line = message.line
        const sourceLine = Math.floor(line)
        const fraction = line - sourceLine
        const text = editor.document.lineAt(sourceLine).text
        const start = Math.floor(fraction * text.length)
        const range = new vscode.Range(sourceLine - 1, start, sourceLine, 0)
        const strategy = vscode.TextEditorRevealType.AtTop
        editor.revealRange(range, strategy)
      }
    } else {
      throw new Error(`Unexpected message: ${JSON.stringify(message)}`)
    }
  }

  private async tryScrollToRangeStartOfEditor(editor: vscode.TextEditor): Promise<void> {
    if (!this.isPreviewOf(editor.document.uri)) {
      return
    }
    if (this.webviewIsScrolling) {
      this.webviewIsScrolling = false
      return
    }
    this.resourceIsScrolling = true
    await this.scrollToRangeStartOfEditor(editor)
  }

  private async scrollToRangeStartOfEditor(editor: vscode.TextEditor): Promise<void> {
    const firstVisiblePosition = editor.visibleRanges[0].start
    const lineNumber = firstVisiblePosition.line
    const lineContent = editor.document.lineAt(lineNumber)
    const progress = firstVisiblePosition.character / (lineContent.text.length + 2)
    await this.postMessage({ type: 'scroll-in-preview', line: lineNumber + progress + 1 })
  }

  async tryRebindToActiveResource(force: boolean): Promise<void> {
    const activeCnxml = this.activeCnxmlUri()
    await this.tryRebindToResource(activeCnxml, force)
  }

  async tryRebindToResource(resource: vscode.Uri | null, force: boolean): Promise<void> {
    if (resource == null && !force) {
      return
    }
    const bindingChanged = resource?.fsPath !== this.resourceBinding?.fsPath
    await this.rebindToResource(resource)
    const activeEditor = vscode.window.activeTextEditor
    if (activeEditor != null) {
      await this.scrollToRangeStartOfEditor(activeEditor)
    }
    if (bindingChanged || force) {
      this._onDidChangeResourceBinding.fire(resource)
    }
  }

  private activeCnxmlUri(): vscode.Uri | null {
    const activeEditor = vscode.window.activeTextEditor
    if (activeEditor == null) {
      return null
    }
    const activeDocument = activeEditor.document
    if (!isXmlFile(activeDocument)) {
      return null
    }
    const activeUri = activeDocument.uri
    if (!(path.extname(activeUri.fsPath) === '.cnxml')) {
      return null
    }
    return activeUri
  }

  private async refreshContentsMessage(resource: vscode.Uri): Promise<PanelOutgoingMessage> {
    // TODO: Get resource contents from the language server?
    const contents = await fs.promises.readFile(resource.fsPath, { encoding: 'utf-8' })
    const doc = new DOMParser().parseFromString(contents)
    tagElementsWithLineNumbers(doc)
    const lineTaggedContents = new XMLSerializer().serializeToString(doc)
    // Load XSL if we haven't already
    if (this.xsl === '') {
      this.xsl = await fs.promises.readFile(
        path.join(this.context.resourceRootDir, 'cnxml-to-html5.xsl'),
        'utf-8'
      )
    }
    return { type: 'refresh', xml: lineTaggedContents, xsl: this.xsl }
  }

  isPreviewOf(resource: vscode.Uri | null): boolean {
    return resource?.fsPath === this.resourceBinding?.fsPath
  }

  private async rebindToResource(resource: vscode.Uri | null): Promise<void> {
    const oldBinding = this.resourceBinding
    this.resourceBinding = resource
    if (this.resourceBinding == null) {
      this.panel.webview.html = rawTextHtml('No resource available to preview')
      return
    }
    const message = await this.refreshContentsMessage(this.resourceBinding)
    if (oldBinding == null) {
      const html = await this.reboundWebviewHtmlForResource(this.resourceBinding, [message])
      this.panel.webview.html = html
    } else {
      void this.postMessage(message)
    }
  }

  private async reboundWebviewHtmlForResource(resource: vscode.Uri, messages: PanelOutgoingMessage[] = []): Promise<string> {
    let html = await fs.promises.readFile(path.join(this.context.resourceRootDir, 'cnxml-preview.html'), 'utf-8')
    html = this.injectEnsuredMessages(html, messages)
    html = addBaseHref(this.panel.webview, resource, html)
    html = fixResourceReferences(this.panel.webview, html, this.context.resourceRootDir)
    html = fixCspSourceReferences(this.panel.webview, html)
    return html
  }
}
