import vscode from 'vscode'
import fs from 'fs'
import path from 'path'
import { fixResourceReferences, fixCspSourceReferences, addBaseHref, getLocalResourceRoots, ensureCatch } from './utils'
import { PanelType } from './extension-types'

export interface PanelIncomingMessage {
  xml?: string
}

export const getContents = (uri?: vscode.Uri): [string | undefined, vscode.TextEditor | undefined, vscode.Uri | undefined] => {
  let contents: string | undefined
  const editor = vscode.window.activeTextEditor

  if (editor != null) {
    const activeDocument = editor.document
    contents = activeDocument.getText()
    return [contents, editor, activeDocument.uri]
  }
  return [contents, editor, uri]
}

export const showCnxmlPreview = (panelType: PanelType, resourceRootDir: string, activePanelsByType: {[key in PanelType]?: vscode.WebviewPanel}) => async (uri?: vscode.Uri, previewSettings?: any) => {
  let [contents, editor, resource] = getContents()
  if (contents == null || resource == null) { return }
  const definitelyResource = resource

  const resourceColumn = editor?.viewColumn ?? vscode.ViewColumn.One
  const previewColumn = resourceColumn + 1 // because the preview is on the side

  const panel = vscode.window.createWebviewPanel(
    panelType,
    `Preview ${path.basename(resource.fsPath)}`,
    previewColumn, {
      enableScripts: true,
      localResourceRoots: getLocalResourceRoots([vscode.Uri.file(resourceRootDir)], resource),
      enableFindWidget: true
    }
  )
  activePanelsByType[panelType] = panel
  let disposed = false

  let html = fs.readFileSync(path.join(resourceRootDir, 'cnxml-preview.html'), 'utf-8')
  html = addBaseHref(panel.webview, resource, html)
  html = fixResourceReferences(panel.webview, html, resourceRootDir)
  html = fixCspSourceReferences(panel.webview, html)
  panel.webview.html = html

  const xml = contents
  await panel.webview.postMessage({ xml })
  let throttleTimer = setTimeout(() => {
    updatePreview().catch((err) => { throw new Error(err) })
  }, 200)

  async function updatePreview(): Promise<void> {
    clearTimeout(throttleTimer)
    if (disposed) {
      return
    }
    let document: vscode.TextDocument
    try {
      document = await vscode.workspace.openTextDocument(definitelyResource)
    } catch {
      return
    }
    const newContents = document.getText()
    if (contents !== newContents) {
      contents = newContents
      await panel.webview.postMessage({ xml: contents })
    }
    throttleTimer = setTimeout(() => {
      updatePreview().catch((err) => { throw new Error(err) })
    }, 200)
  }

  // https://code.visualstudio.com/api/extension-guides/webview#scripts-and-message-passing
  panel.webview.onDidReceiveMessage(ensureCatch(handleMessage(resource)))
  panel.onDidDispose(() => {
    disposed = true
  })

  panel.onDidChangeViewState(async event => {
    // Trigger a message to the panel by resetting the content whenever the
    // view state changes and it is active.
    if (event.webviewPanel.active) {
      contents = undefined
      await updatePreview()
    }
  })
}

export const handleMessage = (resource: vscode.Uri) => async (message: PanelIncomingMessage) => {
  const { xml } = message
  if (xml == null) {
    return
  }
  const document = await vscode.workspace.openTextDocument(resource)
  const fullRange = new vscode.Range(
    document.positionAt(0),
    document.positionAt(document.getText().length)
  )
  const edit = new vscode.WorkspaceEdit()
  edit.replace(resource, fullRange, xml)
  await vscode.workspace.applyEdit(edit)
}
