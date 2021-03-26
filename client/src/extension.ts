import vscode from 'vscode'
import path from 'path'
import { LanguageClient } from 'vscode-languageclient/node'
import { handleMessage, showTocEditor } from './panel-toc-editor'
import { showImageUpload } from './panel-image-upload'
import { showCnxmlPreview } from './panel-cnxml-preview'
import { pushContent } from './push-content'
import { expect, ensureCatch, launchLanguageServer, populateXsdSchemaFiles } from './utils'
import { commandToPanelType, OpenstaxCommand, PanelType } from './extension-types'

const resourceRootDir = path.join(__dirname) // extension is running in dist/
// Only one instance of each type allowed at any given time
const activePanelsByType: {[key in PanelType]?: vscode.WebviewPanel} = {}
const extensionExports = {
  activePanelsByType
}
let client: LanguageClient

export async function activate(context: vscode.ExtensionContext): Promise<(typeof extensionExports)> {
  // detect Theia. Alert the user if they are running Theia
  expect(process.env.GITPOD_HOST != null && process.env.EDITOR !== 'code' ? undefined : true, 'You seem to be running the Theia editor. Change your Settings in your profile')

  client = launchLanguageServer(context)
  populateXsdSchemaFiles(resourceRootDir)
  await client.onReady()

  const activationByType: {[key in PanelType]: any} = {
    [PanelType.TOC_EDITOR]: ensureCatch(showTocEditor(PanelType.TOC_EDITOR, resourceRootDir, activePanelsByType, client)),
    [PanelType.IMAGE_UPLOAD]: ensureCatch(showImageUpload(PanelType.IMAGE_UPLOAD, resourceRootDir, activePanelsByType)),
    [PanelType.CNXML_PREVIEW]: ensureCatch(showCnxmlPreview(PanelType.CNXML_PREVIEW, resourceRootDir, activePanelsByType))
  }
  const defaultLocationByType: {[key in PanelType]: vscode.ViewColumn} = {
    [PanelType.TOC_EDITOR]: vscode.ViewColumn.One,
    [PanelType.IMAGE_UPLOAD]: vscode.ViewColumn.One,
    [PanelType.CNXML_PREVIEW]: vscode.ViewColumn.Two
  }

  const lazilyFocusOrOpenPanelOfType = (type: PanelType) => {
    return (...args: any[]) => {
      if (activePanelsByType[type] != null) {
        const activePanel = expect(activePanelsByType[type])
        try {
          activePanel.reveal(defaultLocationByType[type])
          return
        } catch (err) {
          // Panel was probably disposed
          return activationByType[type](...args)
        }
      }
      return activationByType[type](...args)
    }
  }

  vscode.workspace.onDidChangeWorkspaceFolders(async (event) => {
    await client.sendRequest('onDidChangeWorkspaceFolders', event)
  })
  client.onRequest('onDidChangeWatchedFiles', async () => {
    const activeTocEditor = activePanelsByType[PanelType.TOC_EDITOR]
    if (activeTocEditor != null) {
      try {
        await handleMessage(activeTocEditor, client)({ type: 'refresh' })
      } catch { /* Panel was probably disposed */ }
    }
  })
  vscode.commands.registerCommand(OpenstaxCommand.SHOW_TOC_EDITOR, lazilyFocusOrOpenPanelOfType(commandToPanelType[OpenstaxCommand.SHOW_TOC_EDITOR]))
  vscode.commands.registerCommand(OpenstaxCommand.SHOW_IMAGE_UPLOAD, lazilyFocusOrOpenPanelOfType(commandToPanelType[OpenstaxCommand.SHOW_IMAGE_UPLOAD]))
  vscode.commands.registerCommand(OpenstaxCommand.SHOW_CNXML_PREVIEW, lazilyFocusOrOpenPanelOfType(commandToPanelType[OpenstaxCommand.SHOW_CNXML_PREVIEW]))
  vscode.commands.registerCommand('openstax.pushContent', ensureCatch(pushContent()))

  return extensionExports
}

export async function deactivate(): Promise<void> {
  if (client === undefined) {
    return
  }
  return await client.stop()
}
