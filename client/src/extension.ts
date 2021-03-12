import vscode from 'vscode'
import path from 'path'
import { LanguageClient } from 'vscode-languageclient/node'
import { showTocEditor } from './panel-toc-editor'
import { showImageUpload } from './panel-image-upload'
import { showCnxmlPreview } from './panel-cnxml-preview'
import { expect, ensureCatch, launchLanguageServer, populateXsdSchemaFiles } from './utils'
import { commandToPanelType, OpenstaxCommand, PanelType } from './extension-types'

const resourceRootDir = path.join(__dirname) // extension is running in dist/
let client: LanguageClient

// Only one instance of each type allowed at any given time
const activePanelsByType: {[key in PanelType]?: vscode.WebviewPanel} = {}
const activationByType: {[key in PanelType]: any} = {
  [PanelType.TOC_EDITOR]: ensureCatch(showTocEditor(PanelType.TOC_EDITOR, resourceRootDir, activePanelsByType)),
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
        return activePanel.reveal(defaultLocationByType[type])
      } catch (err) {
        // Panel was probably disposed
        return activationByType[type](...args)
      }
    }
    return activationByType[type](...args)
  }
}

const extensionExports = {
  activePanelsByType
}

export function activate(context: vscode.ExtensionContext): typeof extensionExports {
  client = launchLanguageServer(context)
  populateXsdSchemaFiles(resourceRootDir)
  vscode.commands.registerCommand(OpenstaxCommand.SHOW_TOC_EDITOR, lazilyFocusOrOpenPanelOfType(commandToPanelType[OpenstaxCommand.SHOW_TOC_EDITOR]))
  vscode.commands.registerCommand(OpenstaxCommand.SHOW_IMAGE_UPLOAD, lazilyFocusOrOpenPanelOfType(commandToPanelType[OpenstaxCommand.SHOW_IMAGE_UPLOAD]))
  vscode.commands.registerCommand(OpenstaxCommand.SHOW_CNXML_PREVIEW, lazilyFocusOrOpenPanelOfType(commandToPanelType[OpenstaxCommand.SHOW_CNXML_PREVIEW]))
  return extensionExports
}

export async function deactivate(): Promise<void> {
  expect(client).stop()
}
