import vscode from 'vscode'
import path from 'path'
import { showTocEditor } from './panel-toc-editor'
import { showImageUpload } from './panel-image-upload'
import { showCnxmlPreview } from './panel-cnxml-preview'
import { PanelType } from './panel-type'
import { expect, ensureCatch } from './utils'

const resourceRootDir = path.join(__dirname) // extension is running in dist/

// Only one instance of each type allowed at any given time
const activePanelsByType: {[key in PanelType]?: vscode.WebviewPanel} = {}
const activationByType: {[key in PanelType]: any} = {
  'openstax.tocEditor': ensureCatch(showTocEditor(resourceRootDir, activePanelsByType)),
  'openstax.imageUpload': ensureCatch(showImageUpload(resourceRootDir, activePanelsByType)),
  'openstax.cnxmlPreview': ensureCatch(showCnxmlPreview(resourceRootDir, activePanelsByType))
}
const defaultLocationByType: {[key in PanelType]: vscode.ViewColumn} = {
  'openstax.tocEditor': vscode.ViewColumn.One,
  'openstax.imageUpload': vscode.ViewColumn.One,
  'openstax.cnxmlPreview': vscode.ViewColumn.Two
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

const extensionExports = {
  activePanelsByType
}
export function activate(context: vscode.ExtensionContext): typeof extensionExports {
  vscode.commands.registerCommand('openstax.showTocEditor', lazilyFocusOrOpenPanelOfType('openstax.tocEditor'))
  vscode.commands.registerCommand('openstax.showImageUpload', lazilyFocusOrOpenPanelOfType('openstax.imageUpload'))
  vscode.commands.registerCommand('openstax.showPreviewToSide', lazilyFocusOrOpenPanelOfType('openstax.cnxmlPreview'))
  return extensionExports
}

export function deactivate(): void {
}
