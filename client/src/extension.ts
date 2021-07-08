import vscode from 'vscode'
import path from 'path'
import { LanguageClient } from 'vscode-languageclient/node'
import { pushContent, tagContent } from './push-content'
import { TocEditorPanel } from './panel-toc-editor'
import { CnxmlPreviewPanel } from './panel-cnxml-preview'
import { expect, ensureCatch, launchLanguageServer, populateXsdSchemaFiles } from './utils'
import { OpenstaxCommand } from './extension-types'
import { ExtensionHostContext, Panel, PanelManager } from './panel'
import { ImageManagerPanel } from './panel-image-manager'
import { TocTreeItem, TocTreesProvider, toggleTocTreesFilteringHandler } from './toc-trees'

const resourceRootDir = path.join(__dirname) // extension is running in dist/
let tocTreesView: vscode.TreeView<TocTreeItem>
let tocTreesProvider: TocTreesProvider
let client: LanguageClient
const onDidChangeWatchedFilesEmitter: vscode.EventEmitter<void> = new vscode.EventEmitter()
const onDidChangeWatchedFiles = onDidChangeWatchedFilesEmitter.event

export const forwardOnDidChangeWorkspaceFolders = (clientInner: LanguageClient) => async (event: vscode.WorkspaceFoldersChangeEvent) => {
  await clientInner.sendRequest('onDidChangeWorkspaceFolders', event)
}

type ExtensionExports = { [key in OpenstaxCommand]: PanelManager<Panel<unknown, unknown>> }
export async function activate(context: vscode.ExtensionContext): Promise<ExtensionExports> {
  // detect Theia. Alert the user if they are running Theia
  expect(process.env.GITPOD_HOST != null && process.env.EDITOR?.includes('code') === false ? undefined : true, 'You seem to be running the Theia editor. Change your Settings in your profile')

  client = launchLanguageServer(context)
  await populateXsdSchemaFiles(resourceRootDir)
  await client.onReady()

  // It is a logic error for anything else to listen to this event from the client.
  // It is only allowed a single handler, from what we can tell
  client.onRequest('onDidChangeWatchedFiles', () => { onDidChangeWatchedFilesEmitter.fire() })

  const hostContext: ExtensionHostContext = {
    resourceRootDir,
    client, // FIXME: only pass in client.sendRequest, so as to disallow anything from calling onRequest
    events: {
      onDidChangeWatchedFiles
    }
  }
  const tocPanelManager = new PanelManager(hostContext, TocEditorPanel)
  const cnxmlPreviewPanelManager = new PanelManager(hostContext, CnxmlPreviewPanel)
  const imageManagerPanelManager = new PanelManager(hostContext, ImageManagerPanel)

  tocTreesProvider = new TocTreesProvider(hostContext)

  vscode.workspace.onDidChangeWorkspaceFolders(ensureCatch(forwardOnDidChangeWorkspaceFolders(client)))
  vscode.commands.registerCommand(OpenstaxCommand.SHOW_TOC_EDITOR, tocPanelManager.revealOrNew.bind(tocPanelManager))
  vscode.commands.registerCommand(OpenstaxCommand.SHOW_IMAGE_MANAGER, imageManagerPanelManager.revealOrNew.bind(imageManagerPanelManager))
  vscode.commands.registerCommand(OpenstaxCommand.SHOW_CNXML_PREVIEW, cnxmlPreviewPanelManager.revealOrNew.bind(cnxmlPreviewPanelManager))
  vscode.commands.registerCommand('openstax.pushContent', ensureCatch(pushContent()))
  vscode.commands.registerCommand('openstax.tagContent', ensureCatch(tagContent))
  vscode.commands.registerCommand('openstax.refreshTocTrees', tocTreesProvider.refresh.bind(tocTreesProvider))
  tocTreesView = vscode.window.createTreeView('tocTrees', { treeDataProvider: tocTreesProvider, showCollapseAll: true })
  vscode.commands.registerCommand('openstax.toggleTocTreesFiltering', ensureCatch(toggleTocTreesFilteringHandler(tocTreesView, tocTreesProvider)))

  const extExports: ExtensionExports = {
    [OpenstaxCommand.SHOW_TOC_EDITOR]: tocPanelManager,
    [OpenstaxCommand.SHOW_CNXML_PREVIEW]: cnxmlPreviewPanelManager,
    [OpenstaxCommand.SHOW_IMAGE_MANAGER]: imageManagerPanelManager
  }
  return extExports
}

export async function deactivate(): Promise<void> {
  await expect(client, 'Expected client to have been activated').stop()
}
