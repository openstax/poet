import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  TextDocumentSyncKind,
  InitializeResult
} from 'vscode-languageserver/node'

import { TextDocument } from 'vscode-languageserver-textdocument'
import { URI, Utils } from 'vscode-uri'
import { expect } from './model/utils'

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
import { Bundle } from './model/bundle'
import { Factory } from './model/factory'
import { pageAsTreeObject, BundleLoadManager } from './model-adapter'
sourcemaps.install()

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all)

// Create a simple text document manager.
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument)

function getBundleForUri(uri: string): BundleLoadManager {
  const bundles = bundleFactory.all().filter(b => uri.startsWith(b.bundle.workspaceRoot))
  return expect(bundles.first(), 'BUG: Workspace should have loaded up an instance by now.')
}

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
  // https://microsoft.github.io/language-server-protocol/specification#workspace_workspaceFolders
  params.workspaceFolders?.forEach(w => bundleFactory.get(w.uri)) // create bundles.

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
          // changeNotification: true,
          supported: true
        }
      }
    }
  }
  return result
})

connection.onInitialized(() => {
  const inner = async (): Promise<void> => {
    const currentWorkspaces = (await connection.workspace.getWorkspaceFolders()) ?? []
    for (const workspace of currentWorkspaces) {
      const manager = bundleFactory.get(workspace.uri)
      manager.performInitialValidation()
    }
  }
  inner().catch(e => { throw e })
})

documents.onDidOpen(({ document }) => {
  const inner = async (): Promise<void> => {
    const eventUri = URI.parse(document.uri)
    if (eventUri.scheme !== 'file') {
      return
    }
    const manager = getBundleForUri(document.uri)
    const context = { workspace: manager.bundle.workspaceRoot, doc: document.uri }
    manager.loadEnoughToSendDiagnostics(context)
  }
  inner().catch(err => { throw err })
})

documents.onDidChangeContent(({ document }) => {
  const manager = getBundleForUri(document.uri)
  manager.updateFileContents(document.uri, document.getText())
})
connection.onDidChangeWatchedFiles(({ changes }) => {
  const inner = async (): Promise<void> => {
    for (const change of changes) {
      const changedFileUri = URI.parse(change.uri)
      if (changedFileUri.scheme !== 'file') {
        continue
      }
      const manager = getBundleForUri(change.uri)
      await manager.processFilesystemChange(change)
    }
    await connection.sendRequest('onDidChangeWatchedFiles')
  }
  inner().catch(err => { throw err })
})

connection.onRequest(ExtensionServerRequest.BundleTrees, bundleTreesHandler())

connection.onRequest(ExtensionServerRequest.BundleOrphanedModules, async ({ workspaceUri }: BundleOrphanedModulesArgs): Promise<BundleOrphanedModulesResponse> => {
  const manager = getBundleForUri(workspaceUri)
  await manager.loadEnoughForOrphans()
  return manager.orhpanedPages().map(pageAsTreeObject).toArray()
})

connection.onRequest(ExtensionServerRequest.BundleModules, ({ workspaceUri }: BundleModulesArgs): BundleModulesResponse => {
  const manager = getBundleForUri(workspaceUri)
  return manager.allPages().map(pageAsTreeObject).toArray()
})

connection.onRequest(ExtensionServerRequest.BundleEnsureIds, bundleEnsureIdsHandler())

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection)

// Listen on the connection
connection.listen()
