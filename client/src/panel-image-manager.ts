import vscode from 'vscode'
import fs from 'fs'
import path from 'path'
import { fixResourceReferences, fixCspSourceReferences, getRootPathUri, expect } from './utils'
import { PanelType } from './extension-types'
import { type ExtensionHostContext, Panel } from './panel'

export interface PanelIncomingMessage {
  mediaUploads: Array<{ mediaName: string, data: string }>
}

const initPanel = (context: ExtensionHostContext): vscode.WebviewPanel => {
  const localResourceRoots = [vscode.Uri.file(context.resourceRootDir)]
  const workspaceRoot = getRootPathUri()
  /* istanbul ignore else */
  if (workspaceRoot != null) {
    localResourceRoots.push(workspaceRoot)
  }
  const panel = vscode.window.createWebviewPanel(
    PanelType.IMAGE_MANAGER,
    'Image Manager',
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      localResourceRoots
    }
  )

  let html = fs.readFileSync(path.join(context.resourceRootDir, 'image-upload.html'), 'utf-8')
  html = fixResourceReferences(panel.webview, html, context.resourceRootDir)
  html = fixCspSourceReferences(panel.webview, html)
  panel.webview.html = html
  return panel
}

export class ImageManagerPanel extends Panel<PanelIncomingMessage, void, void> {
  constructor(private readonly context: ExtensionHostContext) {
    super(initPanel(context))
  }

  /* istanbul ignore next */
  protected getState() { throw new Error('BUG: Not implemented') }

  async handleMessage(message: PanelIncomingMessage): Promise<void> {
    const { mediaUploads } = message
    const uri = expect(getRootPathUri(), 'panel must act on the root workspace')
    for (const upload of mediaUploads) {
      const { mediaName, data } = upload
      const newFileUri = uri.with({ path: path.join(uri.path, 'media', mediaName) })
      try {
        await vscode.workspace.fs.stat(newFileUri)
        // FIXME: File exists already, do nothing for now. Maybe we should confirm the action?
        return
      } catch (err) {
        /* istanbul ignore else */
        if (err instanceof vscode.FileSystemError && err.name.includes('EntryNotFound')) {
          const content = Buffer.from(data.split(',')[1], 'base64')
          await vscode.workspace.fs.writeFile(newFileUri, content)
        }
      }
    }
  }
}
