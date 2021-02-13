import vscode from 'vscode'
import fs from 'fs'
import path from 'path'
import { fixResourceReferences, fixCspSourceReferences, getRootPathUri, ensureCatch } from './utils'
import { PanelType } from './extension-types'

export interface PanelIncomingMessage {
  mediaUploads?: Array<{mediaName: string, data: string}>
}

export const showImageUpload = (panelType: PanelType, resourceRootDir: string, activePanelsByType: {[key in PanelType]?: vscode.WebviewPanel}) => async () => {
  const panel = vscode.window.createWebviewPanel(
    panelType,
    'ImageUpload',
    vscode.ViewColumn.One,
    {
      enableScripts: true
    }
  )

  let html = fs.readFileSync(path.join(resourceRootDir, 'image-upload.html'), 'utf-8')
  html = fixResourceReferences(panel.webview, html, resourceRootDir)
  html = fixCspSourceReferences(panel.webview, html)
  panel.webview.html = html

  panel.reveal(vscode.ViewColumn.One)
  activePanelsByType[panelType] = panel

  panel.webview.onDidReceiveMessage(ensureCatch(handleMessage()))
}

export const handleMessage = () => async (message: PanelIncomingMessage) => {
  const { mediaUploads } = message
  const uri = getRootPathUri()
  if (mediaUploads == null || uri == null) {
    return
  }
  for (const upload of mediaUploads) {
    const { mediaName, data } = upload
    const newFileUri = uri.with({ path: path.join(uri.path, 'media', mediaName) })
    try {
      await vscode.workspace.fs.stat(newFileUri)
      // FIXME: File exists already, do nothing for now. Maybe we should confirm the action?
      return
    } catch (err) {
      if (err instanceof vscode.FileSystemError && err.name.includes('EntryNotFound')) {
        console.log(`writing: ${newFileUri.toString()}`)
        const content = Buffer.from(data.split(',')[1], 'base64')
        await vscode.workspace.fs.writeFile(newFileUri, content)
      }
    }
  }
}
