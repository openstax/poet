import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  TextDocumentSyncKind,
  InitializeResult,
  CompletionItem,
  CancellationToken,
  CompletionParams
} from 'vscode-languageserver/node'

import { TextDocument } from 'vscode-languageserver-textdocument'
import { URI, Utils } from 'vscode-uri'
import { expectValue } from './model/utils'

import { ExtensionServerRequest } from '../../common/src/requests'
import { bundleEnsureIdsHandler, imageAutocompleteHandler } from './server-handler'

import * as sourcemaps from 'source-map-support'
import { Bundle } from './model/bundle'
import { Factory } from './model/factory'
import { ModelManager } from './model-manager'
import { JobRunner } from './job-runner'
import { TocModificationParams, TocNodeKind } from '../../common/src/toc'
sourcemaps.install()

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all)

// Create a simple text document manager.
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument)

function getBundleForUri(uri: string): ModelManager {
  const bundles = bundleFactory.all.filter(b => uri.startsWith(b.bundle.workspaceRootUri))
  return expectValue(bundles.first(), 'BUG: Workspace should have loaded up an instance by now.')
}

const pathHelper = {
  join: (uri: string, ...relPaths: string[]) => Utils.joinPath(URI.parse(uri), ...relPaths).toString(),
  dirname: (uri: string) => Utils.dirname(URI.parse(uri)).toString()
}

export /* for server-handler.ts */ const bundleFactory = new Factory(workspaceUri => {
  const filePath = workspaceUri
  const b = new Bundle(pathHelper, filePath)
  return new ModelManager(b, connection)
})

const consoleDebug = (...args: any[]) => {
  console.debug(...args)
  // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
  connection.console.log(args.map(a => `${a}`).join(', '))
}
ModelManager.debug = consoleDebug
JobRunner.debug = () => {}

connection.onInitialize(async (params: InitializeParams) => {
  // https://microsoft.github.io/language-server-protocol/specification#workspace_workspaceFolders
  params.workspaceFolders?.forEach(w => bundleFactory.getOrAdd(w.uri)) // create bundles.

  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: {
        // Get notifications when documents are opened / closed and also
        // for content changes using incremental updates
        openClose: true,
        change: TextDocumentSyncKind.Incremental
      },
      completionProvider: {
        resolveProvider: false,
        triggerCharacters: ['.']
      },
      documentLinkProvider: {
        resolveProvider: false
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
      const manager = bundleFactory.getOrAdd(workspace.uri)
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
    manager.performInitialValidation() // just-in-case. It seems to be missed sometimes
    manager.loadEnoughToSendDiagnostics(manager.bundle.workspaceRootUri, document.uri, document.getText())
  }
  inner().catch(err => { throw err })
})

documents.onDidClose(({ document }) => {
  const manager = getBundleForUri(document.uri)
  manager.closeDocument(document.uri)
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

connection.onRequest(ExtensionServerRequest.TocModification, async (params: TocModificationParams) => {
  const { event } = params
  const manager = getBundleForUri(params.workspaceUri)
  if (event.type === TocNodeKind.Page) {
    await manager.createPage(event.bookIndex, event.title)
  } else if (event.type === TocNodeKind.Subbook) {
    await manager.createSubbook(event.bookIndex, event.title)
  } else {
    await manager.modifyToc(event)
  }
})

connection.onRequest(ExtensionServerRequest.BundleEnsureIds, bundleEnsureIdsHandler())

connection.onCompletionResolve((a: CompletionItem, token: CancellationToken): CompletionItem => a)

connection.onCompletion(async (params: CompletionParams): Promise<CompletionItem[]> => {
  const manager = getBundleForUri(params.textDocument.uri)
  return await imageAutocompleteHandler(params, manager)
})
connection.onDocumentLinks(async ({ textDocument }) => {
  const { uri } = textDocument
  const manager = getBundleForUri(uri)
  const page = manager.bundle.allPages.get(uri)
  if (page !== undefined) {
    return await manager.getDocumentLinks(page)
  } else {
    return []
  }
})

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection)

// Listen on the connection
connection.listen()
