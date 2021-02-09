import vscode from 'vscode'
import path from 'path'
import { showTocEditor } from './panel-toc-editor'
import { showImageUpload } from './panel-image-upload'
import { showCnxmlPreview } from './panel-cnxml-preview'

const resourceRootDir = path.join(__dirname) // extension is running in dist/

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  vscode.commands.registerCommand('openstax.showTocEditor', showTocEditor(resourceRootDir))
  vscode.commands.registerCommand('openstax.showImageUpload', showImageUpload(resourceRootDir))
  vscode.commands.registerCommand('openstax.showPreviewToSide', showCnxmlPreview(resourceRootDir))
}

export async function deactivate(): Promise<void> {
}
