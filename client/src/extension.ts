import path from 'path'
import fs from 'fs'
import vscode from 'vscode'
import { LanguageClient } from 'vscode-languageclient/node'
import { pushContent, validateContent, setDefaultGitConfig } from './push-content'
import { TocEditorPanel } from './panel-toc-editor'
import { CnxmlPreviewPanel } from './panel-cnxml-preview'
import { expect, ensureCatch, ensureCatchPromise, launchLanguageServer, populateXsdSchemaFiles, getRootPathUri, configureWorkspaceSettings } from './utils'
import { OpenstaxCommand } from './extension-types'
import { ExtensionHostContext, Panel, PanelManager } from './panel'
import { ImageManagerPanel } from './panel-image-manager'
import { toggleTocTreesFilteringHandler } from './toc-trees-provider'
import { BookOrTocNode, TocsTreeProvider } from './book-tocs'
import { BooksAndOrphans, EMPTY_BOOKS_AND_ORPHANS, ExtensionServerNotification } from '../../common/src/requests'
import { writeReadmeForWorkspace } from './readme-generator'

let tocTreesView: vscode.TreeView<BookOrTocNode>
let tocTreesProvider: TocsTreeProvider
let client: LanguageClient
const onDidChangeWatchedFilesEmitter: vscode.EventEmitter<void> = new vscode.EventEmitter()
const onDidChangeWatchedFiles = onDidChangeWatchedFilesEmitter.event

let resourceRootDir = path.join(__dirname, 'static-resources')
let languageServerLauncher = launchLanguageServer
// setters for testing
export function setResourceRootDir(d: string) {
  resourceRootDir = d
}
export function setLanguageServerLauncher(l: typeof languageServerLauncher) {
  languageServerLauncher = l
}
export const forwardOnDidChangeWorkspaceFolders = (clientInner: LanguageClient) => async (event: vscode.WorkspaceFoldersChangeEvent) => {
  await clientInner.sendRequest('onDidChangeWorkspaceFolders', event)
}

type ExtensionExports = { [key in OpenstaxCommand]: PanelManager<Panel<unknown, unknown, unknown>> }
export async function activate(context: vscode.ExtensionContext): Promise<ExtensionExports> {
  // detect Theia. Alert the user if they are running Theia
  /* istanbul ignore next */
  expect(process.env.GITPOD_HOST != null && process.env.EDITOR?.includes('code') === false ? undefined : true, 'You seem to be running the Theia editor. Change your Settings in your profile')

  await configureWorkspaceSettings()

  client = languageServerLauncher(context)
  // Start the client. This will also launch the server
  client.start()

  // If this is not a book repo then don't bother writing the XSD files
  const workspaceRoot = getRootPathUri()
  /* The following istanbul comments are a hack because the coverage seems to misrepresent them as uncovered */
  /* istanbul ignore next */
  if (workspaceRoot !== null && fs.existsSync(path.join(workspaceRoot.fsPath, 'META-INF/books.xml'))) {
    await populateXsdSchemaFiles(resourceRootDir)
  }

  /* istanbul ignore next */
  await client.onReady()
  /* istanbul ignore next */
  const extExports = doRest(client)
  /* istanbul ignore next */
  return extExports
}

export async function deactivate(): Promise<void> {
  await expect(client, 'Expected client to have been activated').stop()
}

function createHostContext(client: LanguageClient): ExtensionHostContext {
  return {
    resourceRootDir,
    client, // FIXME: only pass in client.sendRequest, so as to disallow anything from calling onRequest
    events: {
      onDidChangeWatchedFiles
    },
    bookTocs: EMPTY_BOOKS_AND_ORPHANS
  }
}

function createExports(tocPanelManager: PanelManager<TocEditorPanel>, cnxmlPreviewPanelManager: PanelManager<CnxmlPreviewPanel>, imageManagerPanelManager: PanelManager<ImageManagerPanel>): ExtensionExports {
  return {
    [OpenstaxCommand.SHOW_TOC_EDITOR]: tocPanelManager,
    [OpenstaxCommand.SHOW_CNXML_PREVIEW]: cnxmlPreviewPanelManager,
    [OpenstaxCommand.SHOW_IMAGE_MANAGER]: imageManagerPanelManager
  }
}

function doRest(client: LanguageClient): ExtensionExports {
  const hostContext = createHostContext(client)
  const tocPanelManager = new PanelManager(hostContext, TocEditorPanel)
  const cnxmlPreviewPanelManager = new PanelManager(hostContext, CnxmlPreviewPanel)
  const imageManagerPanelManager = new PanelManager(hostContext, ImageManagerPanel)

  tocTreesProvider = new TocsTreeProvider()
  client.onNotification(ExtensionServerNotification.BookTocs, (params: BooksAndOrphans) => {
    hostContext.bookTocs = params // When a panel opens, make sure it has the latest bookTocs
    tocTreesProvider.update(params.books)
    /* istanbul ignore next */
    void tocPanelManager.panel()?.update(params)
  })

  vscode.workspace.onDidChangeWorkspaceFolders(ensureCatch(forwardOnDidChangeWorkspaceFolders(client)))
  vscode.commands.registerCommand(OpenstaxCommand.SHOW_TOC_EDITOR, tocPanelManager.revealOrNew.bind(tocPanelManager))
  vscode.commands.registerCommand(OpenstaxCommand.SHOW_IMAGE_MANAGER, imageManagerPanelManager.revealOrNew.bind(imageManagerPanelManager))
  vscode.commands.registerCommand(OpenstaxCommand.SHOW_CNXML_PREVIEW, cnxmlPreviewPanelManager.revealOrNew.bind(cnxmlPreviewPanelManager))
  vscode.commands.registerCommand('openstax.pushContent', ensureCatch(pushContent(hostContext)))
  vscode.commands.registerCommand('openstax.generateReadme', ensureCatch(writeReadmeForWorkspace))
  tocTreesView = vscode.window.createTreeView('tocTrees', { treeDataProvider: tocTreesProvider, showCollapseAll: true })
  vscode.commands.registerCommand('openstax.toggleTocTreesFiltering', ensureCatch(toggleTocTreesFilteringHandler(tocTreesView, tocTreesProvider)))
  vscode.commands.registerCommand('openstax.validateContent', ensureCatch(validateContent))
  void ensureCatchPromise(setDefaultGitConfig())

  // It is a logic error for anything else to listen to this event from the client.
  // It is only allowed a single handler, from what we can tell
  client.onRequest('onDidChangeWatchedFiles', () => { onDidChangeWatchedFilesEmitter.fire() })

  return createExports(tocPanelManager, cnxmlPreviewPanelManager, imageManagerPanelManager)
}
