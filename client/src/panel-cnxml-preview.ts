import vscode from 'vscode'
import fs from 'fs'
import path from 'path'
import { fixResourceReferences, fixCspSourceReferences, addBaseHref, expect, getRootPathUri, ensureCatchPromise, ensureCatch } from './utils'
import { PanelType } from './extension-types'
import { DOMParser, XMLSerializer } from 'xmldom'
import { ExtensionHostContext, Panel } from './panel'

export interface DirectEditIncoming {
  type: 'direct-edit'
  xml: string
}

// Line is one-indexed
export interface ScrollInEditorIncoming {
  type: 'scroll-in-editor'
  line: number
}

export type PanelIncomingMessage = (
  DirectEditIncoming
  | ScrollInEditorIncoming
)

export interface RefreshOutgoing {
  type: 'refresh'
  xml: string
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

const initPanel = (context: ExtensionHostContext) => {
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
  private readonly _onDidChangeResourceBinding: vscode.EventEmitter<vscode.Uri | null>
  constructor(private readonly context: ExtensionHostContext) {
    super(initPanel(context))
    this._onDidChangeResourceBinding = new vscode.EventEmitter()
    void ensureCatchPromise(this.tryRebindToActiveResource(true))
    this.registerDisposable(vscode.window.onDidChangeActiveTextEditor((editor) => {
      void ensureCatchPromise(this.tryRebindToActiveResource(false))
    }))
    this.registerDisposable(this.context.events.onDidChangeWatchedFiles(ensureCatch(async () => {
      await this.refreshContents()
    })))
    this.registerDisposable(vscode.window.onDidChangeTextEditorVisibleRanges(event => {
      void ensureCatchPromise(this.tryScrollToRangeStartOfEditor(event.textEditor))
    }))
  }

  readonly onDidChangeResourceBinding: vscode.Event<vscode.Uri | null> = (...args) => {
    return this._onDidChangeResourceBinding.event(...args)
  }

  async handleMessage(message: PanelIncomingMessage): Promise<void> {
    if (message.type === 'direct-edit') {
      const xml = message.xml
      if (this.resourceBinding == null) {
        return
      }
      const document = await vscode.workspace.openTextDocument(this.resourceBinding)
      const fullRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(document.getText().length)
      )
      const edit = new vscode.WorkspaceEdit()
      edit.replace(this.resourceBinding, fullRange, xml)
      await vscode.workspace.applyEdit(edit)
      await document.save()
    } else if (message.type === 'scroll-in-editor') {
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
    if (activeCnxml == null && !force) {
      return
    }
    await this.rebindToResource(activeCnxml)
    const activeEditor = vscode.window.activeTextEditor
    if (activeEditor != null) {
      await this.scrollToRangeStartOfEditor(activeEditor)
    }
    this._onDidChangeResourceBinding.fire(activeCnxml)
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

  private async refreshContents(): Promise<void> {
    if (this.resourceBinding == null) {
      return
    }
    // TODO: Get resource contents from the language server?
    const contents = await fs.promises.readFile(this.resourceBinding.fsPath, { encoding: 'utf-8' })
    const doc = new DOMParser().parseFromString(contents)
    tagElementsWithLineNumbers(doc)
    const lineTaggedContents = new XMLSerializer().serializeToString(doc)
    await this.postMessage({ type: 'refresh', xml: lineTaggedContents })
  }

  isPreviewOf(resource: vscode.Uri | null): boolean {
    return resource?.fsPath === this.resourceBinding?.fsPath
  }

  private async rebindToResource(resource: vscode.Uri | null): Promise<void> {
    this.resourceBinding = resource
    if (resource == null) {
      this.panel.webview.html = rawTextHtml('No resource available to preview')
      return
    }
    this.rebindWebviewHtmlForResource(resource)
    await this.refreshContents()
  }

  private rebindWebviewHtmlForResource(resource: vscode.Uri): void {
    let html = fs.readFileSync(path.join(this.context.resourceRootDir, 'cnxml-preview.html'), 'utf-8')
    html = addBaseHref(this.panel.webview, resource, html)
    html = fixResourceReferences(this.panel.webview, html, this.context.resourceRootDir)
    html = fixCspSourceReferences(this.panel.webview, html)
    this.panel.webview.html = html
  }
}
