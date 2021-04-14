import vscode from 'vscode'
import fs from 'fs'
import path from 'path'
import { fixResourceReferences, fixCspSourceReferences, addBaseHref, expect, getRootPathUri } from './utils'
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

const initPanel = (context: ExtensionHostContext) => () => {
  const editor = vscode.window.activeTextEditor
  const resourceColumn = editor?.viewColumn ?? vscode.ViewColumn.One
  const previewColumn = resourceColumn + 1
  const localResourceRoots = [vscode.Uri.file(context.resourceRootDir)]
  const workspaceRoot = getRootPathUri()
  if (workspaceRoot != null) {
    localResourceRoots.push(workspaceRoot)
  }
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

const isCnxmlFile = (document: vscode.TextDocument): boolean => {
  return document.languageId === 'cnxml'
}
const isXmlFile = (document: vscode.TextDocument): boolean => {
  return document.languageId === 'xml'
}

const rawTextHtml = (text: string): string => {
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
  constructor(private readonly context: ExtensionHostContext) {
    super(initPanel(context))
    this.tryRebindToActiveResource(true).catch(err => {
      throw err
    })

    this.registerDisposable(vscode.window.onDidChangeActiveTextEditor((editor) => {
      this.tryRebindToActiveResource(false).catch(err => {
        throw err
      })
    }))
    this.registerDisposable(this.context.client.onRequest('onDidChangeWatchedFiles', async () => {
      await this.refreshContents()
    }))
    this.registerDisposable(vscode.window.onDidChangeTextEditorVisibleRanges(event => {
      const editor = event.textEditor
      if (!this.isPreviewOf(editor.document.uri)) {
        return
      }
      if (this.webviewIsScrolling) {
        this.webviewIsScrolling = false
        return
      }
      this.resourceIsScrolling = true
      this.scrollToRangeStartOfEditor(editor).catch(err => {
        throw err
      })
    }))
  }

  async handleMessage(message: PanelIncomingMessage): Promise<void> {
    if (message.type === 'direct-edit') {
      const xml = message.xml
      if (xml == null || this.resourceBinding == null) {
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
    } else if (message.type === 'scroll-in-editor') {
      for (const editor of vscode.window.visibleTextEditors) {
        if (!this.isPreviewOf(editor.document.uri)) {
          continue
        }
        if (this.resourceIsScrolling) {
          this.resourceIsScrolling = false
          continue
        }
        this.webviewIsScrolling = true
        const line = message.line
        const sourceLine = Math.floor(line)
        const fraction = line - sourceLine
        const text = editor.document.lineAt(sourceLine).text
        const start = Math.floor(fraction * text.length)
        editor.revealRange(
          new vscode.Range(sourceLine - 1, start, sourceLine, 0),
          vscode.TextEditorRevealType.AtTop
        )
      }
    } else {
      throw new Error(`Unexpected message: ${JSON.stringify(message)}`)
    }
  }

  private async scrollToRangeStartOfEditor(editor: vscode.TextEditor | undefined | null): Promise<void> {
    if (editor == null) {
      return
    }
    const firstVisiblePosition = editor.visibleRanges[0].start
    const lineNumber = firstVisiblePosition.line
    const lineContent = editor.document.lineAt(lineNumber)
    const progress = firstVisiblePosition.character / (lineContent.text.length + 2)
    await this.postMessage({ type: 'scroll-in-preview', line: lineNumber + progress + 1 })
  }

  private async tryRebindToActiveResource(force: boolean): Promise<void> {
    const activeCnxml = this.activeCnxmlUri()
    if (activeCnxml == null && !force) {
      return
    }
    await this.rebindToResource(activeCnxml)
    await this.scrollToRangeStartOfEditor(vscode.window.activeTextEditor)
  }

  private activeCnxmlUri(): vscode.Uri | null {
    const activeEditor = vscode.window.activeTextEditor
    if (activeEditor == null) {
      return null
    }
    const activeDocument = activeEditor.document
    if (!isCnxmlFile(activeDocument) && !isXmlFile(activeDocument)) {
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

  private isPreviewOf(resource: vscode.Uri | null): boolean {
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
