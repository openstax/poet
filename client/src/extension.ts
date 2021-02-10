import vscode from 'vscode'
import path from 'path'
import { LanguageClient } from 'vscode-languageclient/node'
import { showTocEditor } from './panel-toc-editor'
import { showImageUpload } from './panel-image-upload'
import { showCnxmlPreview } from './panel-cnxml-preview'
import { launchLanguageServer } from './utils'

const resourceRootDir = path.join(__dirname) // extension is running in dist/
let client: LanguageClient

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  client = launchLanguageServer(context)
  vscode.commands.registerCommand('openstax.showTocEditor', showTocEditor(resourceRootDir))
  vscode.commands.registerCommand('openstax.showImageUpload', showImageUpload(resourceRootDir))
  vscode.commands.registerCommand('openstax.showPreviewToSide', showCnxmlPreview(resourceRootDir))
}

export async function deactivate(): Promise<void> {
  if (client === undefined) {
    return
  }
  return await client.stop()
}
