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
  expect, profileAsync
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

import { BookBundle } from './book-bundle'
import { BundleValidationQueue } from './bundle-validation'

import * as sourcemaps from 'source-map-support'
import { Bundle, Factory, Validator } from './model'
import { pageAsTreeObject, BundleLoadManager } from './model-adapter'
sourcemaps.install()

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all)

// Create a simple text document manager.
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument)

const workspaceBookBundles: Map<string, [BookBundle, BundleValidationQueue]> = new Map()
export /* for server-handler.ts */ const bundleFactory = new Factory(workspaceUri => {
  const filePath = URI.parse(workspaceUri).fsPath
  const b = new Bundle(filePath)
  return {
    bundle: b,
    manager: new BundleLoadManager(b, connection) 
  }
})

const getWorkspaceRootPath = (workspace: WorkspaceFolder): string => {
  return URI.parse(workspace.uri).fsPath
}

const createBookBundleForWorkspace = async (workspace: WorkspaceFolder): Promise<void> => {
  const workspaceRoot = getWorkspaceRootPath(workspace)
  const bundle = await BookBundle.from(workspaceRoot)
  const bundleValidator = new BundleValidationQueue(bundle, connection)
  workspaceBookBundles.set(workspace.uri, [bundle, bundleValidator])
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
          const bundleValidator = expect(workspaceBookBundles.get(workspace.uri), 'already returned if key missing')[1]
          bundleValidator.addRequest()

          const { manager} = bundleFactory.get(workspace.uri)
          const [_, ms] = await profileAsync(async () => {
            await manager.performInitialValidation()
          })
          console.log('Initial validation took', ms)

        } catch (err) {
          connection.console.error(`Could not parse ${workspace.uri} as a book bundle`)
        }
      }
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
    if (!workspaceBookBundles.has(workspaceChanged.uri)) {
      await createBookBundleForWorkspace(workspaceChanged)
      return
    }
    const bundleValidator = expect(workspaceBookBundles.get(workspaceChanged.uri), 'already returned if key missing')[1]
    bundleValidator.addRequest({ causeUri: event.document.uri })
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
      if (!workspaceBookBundles.has(workspaceChanged.uri)) {
        await createBookBundleForWorkspace(workspaceChanged)
        return
      }
      const [bundleChanged, bundleValidator] = expect(workspaceBookBundles.get(workspaceChanged.uri), 'already returned if key missing')
      bundleChanged.processChange(change)
      const {manager} = bundleFactory.get(workspaceChanged.uri)
      manager.processFilesystemChange(change)
      bundleValidator.addRequest({ causeUri: change.uri })
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
    bundleFactory.remove(workspace.uri.external)
  }
  for (const workspace of event.added) {
    const workspaceCompat: WorkspaceFolder = {
      uri: workspace.uri.external,
      name: workspace.uri.name
    }
    try {
      await createBookBundleForWorkspace(workspaceCompat)
    } catch (err) {
      connection.console.error(`Could not parse ${workspaceCompat.uri} as a book bundle`)
    }
  }
})

connection.onRequest(ExtensionServerRequest.BundleTrees, bundleTreesHandler(workspaceBookBundles, connection))

connection.onRequest(ExtensionServerRequest.BundleOrphanedModules, async ({ workspaceUri }: BundleOrphanedModulesArgs): Promise<BundleOrphanedModulesResponse> => {
  const {manager} = bundleFactory.get(workspaceUri)
  await manager.loadEnoughForOrphans()
  return manager.orhpanedPages().map(pageAsTreeObject).toArray()
})

connection.onRequest(ExtensionServerRequest.BundleModules, ({ workspaceUri }: BundleModulesArgs): BundleModulesResponse => {
  const {manager} = bundleFactory.get(workspaceUri)
  return manager.allPages().map(pageAsTreeObject).toArray()
})

connection.onRequest(ExtensionServerRequest.BundleEnsureIds, bundleEnsureIdsHandler(workspaceBookBundles, connection))

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection)

// Listen on the connection
connection.listen()
