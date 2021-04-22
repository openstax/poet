import vscode from 'vscode'
import path from 'path'
import { LanguageClient } from 'vscode-languageclient/node'
import { refreshPanel, showTocEditor } from './panel-toc-editor'
import { showImageUpload } from './panel-image-upload'
import { showCnxmlPreview } from './panel-cnxml-preview'
import { pushContent, tagContent } from './push-content'
import { expect, ensureCatch, launchLanguageServer, populateXsdSchemaFiles } from './utils'
import { commandToPanelType, OpenstaxCommand, PanelType } from './extension-types'
import { TocTreesProvider } from './toc-trees'

const resourceRootDir = path.join(__dirname) // extension is running in dist/
// Only one instance of each type allowed at any given time
const activePanelsByType: { [key in PanelType]?: vscode.WebviewPanel } = {}
const extensionExports = {
  activePanelsByType
}
let tocTreesProvider: TocTreesProvider
let client: LanguageClient

const defaultLocationByType: { [key in PanelType]: vscode.ViewColumn } = {
  [PanelType.TOC_EDITOR]: vscode.ViewColumn.One,
  [PanelType.IMAGE_UPLOAD]: vscode.ViewColumn.One,
  [PanelType.CNXML_PREVIEW]: vscode.ViewColumn.Two
}

export const refreshTocPanel = (clientInner: LanguageClient) => async () => {
  const activeTocEditor = activePanelsByType[PanelType.TOC_EDITOR]
  if (activeTocEditor != null) {
    await refreshPanel(activeTocEditor, clientInner)
  }
}

export const invokeRefreshers = (funcs: Array<() => Promise<void>>) => async () => {
  funcs.forEach((fn) => {
    fn().catch((err: Error) => { throw err })
  })
}

export const createLazyPanelOpener = (activationByType: { [key in PanelType]: any }) => (type: PanelType, hardRefocus: boolean) => {
  return (...args: any[]) => {
    if (activePanelsByType[type] != null) {
      const activePanel = expect(activePanelsByType[type], `Could not find panel type '${type}'`)
      try {
        if (!hardRefocus) {
          activePanel.reveal(defaultLocationByType[type])
          return
        }
        activePanel.dispose()
      } catch (err) {
        // Panel was probably disposed already
        return activationByType[type](...args)
      }
    }
    return activationByType[type](...args)
  }
}

export const forwardOnDidChangeWorkspaceFolders = (clientInner: LanguageClient) => async (event: vscode.WorkspaceFoldersChangeEvent) => {
  await clientInner.sendRequest('onDidChangeWorkspaceFolders', event)
}

export async function activate(context: vscode.ExtensionContext): Promise<(typeof extensionExports)> {
  // detect Theia. Alert the user if they are running Theia
  expect(process.env.GITPOD_HOST != null && process.env.EDITOR?.includes('code') === false ? undefined : true, 'You seem to be running the Theia editor. Change your Settings in your profile')

  client = launchLanguageServer(context)
  populateXsdSchemaFiles(resourceRootDir)
  await client.onReady()

  const activationByType: { [key in PanelType]: any } = {
    [PanelType.TOC_EDITOR]: ensureCatch(showTocEditor(PanelType.TOC_EDITOR, resourceRootDir, activePanelsByType, client)),
    [PanelType.IMAGE_UPLOAD]: ensureCatch(showImageUpload(PanelType.IMAGE_UPLOAD, resourceRootDir, activePanelsByType)),
    [PanelType.CNXML_PREVIEW]: ensureCatch(showCnxmlPreview(PanelType.CNXML_PREVIEW, resourceRootDir, activePanelsByType))
  }

  const lazilyFocusOrOpenPanelOfType = createLazyPanelOpener(activationByType)
  tocTreesProvider = new TocTreesProvider(client)

  vscode.workspace.onDidChangeWorkspaceFolders(ensureCatch(forwardOnDidChangeWorkspaceFolders(client)))
  client.onRequest('onDidChangeWatchedFiles', ensureCatch(invokeRefreshers([refreshTocPanel(client), async () => tocTreesProvider.refresh()])))
  vscode.commands.registerCommand(OpenstaxCommand.SHOW_TOC_EDITOR, lazilyFocusOrOpenPanelOfType(commandToPanelType[OpenstaxCommand.SHOW_TOC_EDITOR], false))
  vscode.commands.registerCommand(OpenstaxCommand.SHOW_IMAGE_UPLOAD, lazilyFocusOrOpenPanelOfType(commandToPanelType[OpenstaxCommand.SHOW_IMAGE_UPLOAD], false))
  vscode.commands.registerCommand(OpenstaxCommand.SHOW_CNXML_PREVIEW, lazilyFocusOrOpenPanelOfType(commandToPanelType[OpenstaxCommand.SHOW_CNXML_PREVIEW], true))
  vscode.commands.registerCommand('openstax.pushContent', ensureCatch(pushContent()))
  vscode.commands.registerCommand('openstax.tagContent', ensureCatch(tagContent()))
  vscode.commands.registerCommand('openstax.refreshTocTrees', ensureCatch(async () => tocTreesProvider.refresh()))
  vscode.window.registerTreeDataProvider('tocTrees', tocTreesProvider)

  return extensionExports
}

export async function deactivate(): Promise<void> {
  await expect(client, 'Expected client to have been activated').stop()
}
