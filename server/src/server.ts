import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  TextDocumentSyncKind,
  InitializeResult,
  WorkspaceFolder
} from 'vscode-languageserver/node'

import {
  TextDocument
} from 'vscode-languageserver-textdocument'

import {
  URI
} from 'vscode-uri'

import {
  ValidationQueue,
  ValidationRequest,
  expect
} from './utils'

import {
  BundleTreesArgs,
  BundleModulesArgs,
  BundleTreesResponse,
  BundleOrphanedModulesArgs,
  BundleModulesResponse,
  BundleOrphanedModulesResponse,
  ExtensionServerRequest
} from '../../common/src/requests'

import { BookBundle } from './book-bundle'

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all)

// Create a simple text document manager.
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument)

const workspaceBookBundles: Map<string, BookBundle> = new Map()
const validationQueue: ValidationQueue = new ValidationQueue(connection)

const getWorkspaceRootPath = (workspace: WorkspaceFolder): string => {
  return URI.parse(workspace.uri).fsPath
}

const createBookBundleForWorkspace = async (workspace: WorkspaceFolder): Promise<void> => {
  const workspaceRoot = getWorkspaceRootPath(workspace)
  workspaceBookBundles.set(workspace.uri, await BookBundle.from(workspaceRoot))
}

const removeBookBundleForWorkspace = (workspace: WorkspaceFolder): void => {
  workspaceBookBundles.delete(workspace.uri)
}

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
    const currentWorkspaces = await connection.workspace.getWorkspaceFolders()
    if (currentWorkspaces != null) {
      for (const workspace of currentWorkspaces) {
        try {
          await createBookBundleForWorkspace(workspace)
        } catch (err) {
          connection.console.log(`Could not parse ${workspace.uri} as a book bundle`)
        }
      }
    }
  }
  inner().catch(e => { throw e })
})

documents.onDidOpen(event => {
  connection.console.log(
    `Language server received an open event for ${event.document.uri}`
  )
})

documents.onDidClose(event => {
  connection.console.log(
    `Language server received a close event for ${event.document.uri}`
  )
})

documents.onDidChangeContent(async event => {
  const textDocument = event.document
  const request: ValidationRequest = {
    textDocument: textDocument,
    version: textDocument.version
  }

  validationQueue.addRequest(request)
})

connection.onDidChangeWatchedFiles(({ changes }) => {
  const inner = async (): Promise<void> => {
    const workspaces = expect(await connection.workspace.getWorkspaceFolders(), 'workspace must be open for event to occur')
    if (workspaces == null) { return }
    for (const change of changes) {
      const changedFileUri = URI.parse(change.uri)
      if (changedFileUri.scheme !== 'file') {
        continue
      }
      const workspaceChanged = expect(workspaces.find((workspace) => change.uri.startsWith(workspace.uri)), `file ${changedFileUri.fsPath} must exist in workspace`)
      if (!workspaceBookBundles.has(workspaceChanged.uri)) {
        await createBookBundleForWorkspace(workspaceChanged)
        return
      }
      const bundleChanged = expect(workspaceBookBundles.get(workspaceChanged.uri), 'already returned if key missing')
      bundleChanged.processChange(change)
    }
    await connection.sendRequest('onDidChangeWatchedFiles')
  }
  inner().catch(err => { throw err })
})

connection.onRequest('onDidChangeWorkspaceFolders', async (event) => {
  for (const workspace of event.removed) {
    const workspaceCompat: WorkspaceFolder = {
      uri: workspace.uri.external,
      name: workspace.uri.name
    }
    removeBookBundleForWorkspace(workspaceCompat)
  }
  for (const workspace of event.added) {
    const workspaceCompat: WorkspaceFolder = {
      uri: workspace.uri.external,
      name: workspace.uri.name
    }
    try {
      await createBookBundleForWorkspace(workspaceCompat)
    } catch (err) {
      connection.console.log(`Could not parse ${workspaceCompat.uri} as a book bundle`)
    }
  }
})

connection.onRequest(ExtensionServerRequest.BundleTrees, async ({ workspaceUri }: BundleTreesArgs): Promise<BundleTreesResponse> => {
  const bundle = workspaceBookBundles.get(workspaceUri)
  if (bundle == null) { return null }
  const trees = await Promise.all(bundle.collections().map(async collection => expect(await bundle.collectionTree(collection), 'collection must exist').inner))
  return trees
})

connection.onRequest(ExtensionServerRequest.BundleOrphanedModules, async ({ workspaceUri }: BundleOrphanedModulesArgs): Promise<BundleOrphanedModulesResponse> => {
  const bundle = workspaceBookBundles.get(workspaceUri)
  if (bundle == null) { return null }
  const orphanModules = Array.from((await bundle.orphanedModules()).inner)
  const result = await Promise.all(orphanModules.map(async m => await bundle.moduleAsTreeObject(m)))
  return result
})

connection.onRequest(ExtensionServerRequest.BundleModules, async ({ workspaceUri }: BundleModulesArgs): Promise<BundleModulesResponse> => {
  const bundle = workspaceBookBundles.get(workspaceUri)
  if (bundle == null) { return null }
  const modules = bundle.modules()
  const result = await Promise.all(modules.map(async m => await bundle.moduleAsTreeObject(m)))
  return result
})

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection)

// Listen on the connection
connection.listen()
