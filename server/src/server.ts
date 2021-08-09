import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  TextDocumentSyncKind,
  InitializeResult
} from 'vscode-languageserver/node'

import {
  TextDocument
} from 'vscode-languageserver-textdocument'

import {
  URI,
  Utils
} from 'vscode-uri'

import {
  expect
} from './utils'

import {
  BundleModulesArgs,
  BundleOrphanedModulesArgs,
  BundleModulesResponse,
  BundleOrphanedModulesResponse,
  ExtensionServerRequest
} from '../../common/src/requests'

import {
  bundleEnsureIdsHandler,
  bundleTreesHandler
} from './server-handler'

import * as sourcemaps from 'source-map-support'
import { Bundle, Factory } from './model'
import { pageAsTreeObject, BundleLoadManager } from './model-adapter'
sourcemaps.install()

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all)

// Create a simple text document manager.
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument)

const pathHelper = {
  join: (uri: string, ...relPaths: string[]) => Utils.joinPath(URI.parse(uri), ...relPaths).toString(),
  dirname: (uri: string) => Utils.dirname(URI.parse(uri)).toString()
}

export /* for server-handler.ts */ const bundleFactory = new Factory(workspaceUri => {
  const filePath = workspaceUri
  const b = new Bundle(pathHelper, filePath)
  return new BundleLoadManager(b, connection) 
})

connection.onInitialize(async (params: InitializeParams) => {
  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: {
        // Get notifications when documents are opened / closed and also
        // for content changes using incremental updates
        openClose: true,
        change: TextDocumentSyncKind.Incremental
      },
      workspace: {
        workspaceFolders: {
          supported: true
        }
      }
    }
  }
  return result
})

connection.onInitialized(() => {
  const inner = async (): Promise<void> => {
    const currentWorkspaces = (await connection.workspace.getWorkspaceFolders()) || []
    for (const workspace of currentWorkspaces) {
      const manager = bundleFactory.get(workspace.uri)
      await manager.performInitialValidation()
    }
  }
  inner().catch(e => { throw e })
})

documents.onDidOpen(event => {
  const inner = async (): Promise<void> => {
    const workspaces = expect(await connection.workspace.getWorkspaceFolders(), 'workspace must be open for event to occur')
    const eventUri = URI.parse(event.document.uri)
    if (eventUri.scheme !== 'file') {
      return
    }
    const workspaceChanged = expect(workspaces.find((workspace) => event.document.uri.startsWith(workspace.uri)), `file ${eventUri.fsPath} must exist in workspace`)

    const context = {workspace: workspaceChanged, doc: event.document }
    const manager = bundleFactory.get(workspaceChanged.uri)
    await manager.loadEnoughToSendDiagnostics(context)
  }
  inner().catch(err => { throw err })
})

documents.onDidChangeContent(async ({document}) => {
  const inner = async (): Promise<void> => {
    const workspaces = expect(await connection.workspace.getWorkspaceFolders(), 'workspace must be open for event to occur')
    const workspaceChanged = expect(workspaces.find((workspace) => document.uri.startsWith(workspace.uri)), `file ${document.uri} must exist in workspace`)
    const manager = expect(bundleFactory.getIfHas(workspaceChanged.uri), 'BUG: Somehow we got here without loading the workspace')
    manager.updateFileContents(document.uri, document.getText())
  }
  inner().catch(err => { throw err })
})
connection.onDidChangeWatchedFiles(({ changes }) => {
  const inner = async (): Promise<void> => {
    const workspaces = expect(await connection.workspace.getWorkspaceFolders(), 'workspace must be open for event to occur')
    for (const change of changes) {
      const changedFileUri = URI.parse(change.uri)
      if (changedFileUri.scheme !== 'file') {
        continue
      }
      const workspaceChanged = expect(workspaces.find((workspace) => change.uri.startsWith(workspace.uri)), `file ${changedFileUri.fsPath} must exist in workspace`)
      const manager = bundleFactory.get(workspaceChanged.uri)
      manager.processFilesystemChange(change)
    }
    await connection.sendRequest('onDidChangeWatchedFiles')
  }
  inner().catch(err => { throw err })
})

connection.onRequest('onDidChangeWorkspaceFolders', async (event) => {
  for (const workspace of event.removed) {
    bundleFactory.remove(workspace.uri.external)
  }
})

connection.onRequest(ExtensionServerRequest.BundleTrees, bundleTreesHandler())

connection.onRequest(ExtensionServerRequest.BundleOrphanedModules, async ({ workspaceUri }: BundleOrphanedModulesArgs): Promise<BundleOrphanedModulesResponse> => {
  const manager = bundleFactory.get(workspaceUri)
  await manager.loadEnoughForOrphans()
  return manager.orhpanedPages().map(pageAsTreeObject).toArray()
})

connection.onRequest(ExtensionServerRequest.BundleModules, ({ workspaceUri }: BundleModulesArgs): BundleModulesResponse => {
  const manager = bundleFactory.get(workspaceUri)
  return manager.allPages().map(pageAsTreeObject).toArray()
})

connection.onRequest(ExtensionServerRequest.BundleEnsureIds, bundleEnsureIdsHandler())

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection)

// Listen on the connection
connection.listen()
