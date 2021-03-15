import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  TextDocumentSyncKind,
  InitializeResult,
  FileChangeType,
  DiagnosticSeverity,
  Position,
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
  generateDiagnostic,
  expect
} from './utils'
import { Repo } from './repo'

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all)

// Create a simple text document manager.
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument)

const workspaceRepos: Map<string, Repo> = new Map()
const validationQueue: ValidationQueue = new ValidationQueue(connection)

const getWorkspaceRootPath = (workspace: WorkspaceFolder): string => {
  return URI.parse(workspace.uri).fsPath
}

const createRepoForWorkspace = async (workspace: WorkspaceFolder) => {
  const workspaceRoot = getWorkspaceRootPath(workspace)
  workspaceRepos.set(workspace.uri, await Repo.from(workspaceRoot))
}

const removeRepoForWorkspace = (workspace: WorkspaceFolder) => {
  workspaceRepos.delete(workspace.uri)
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
  const asyncOnInitialized = async () => {
    const currentWorkspaces = await connection.workspace.getWorkspaceFolders()
    if (currentWorkspaces != null) {
      for (const workspace of currentWorkspaces) {
        await createRepoForWorkspace(workspace)
      }
    }
  }
  asyncOnInitialized().catch(e => {
    throw e
  })
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

// connection.workspace.onDidChangeWorkspaceFolders(async (event) => {
//   event.removed.forEach(removeRepoForWorkspace)
//   for (const workspace of event.added) {
//     await createRepoForWorkspace(workspace)
//   }
// })

connection.onDidChangeWatchedFiles(async ({ changes }) => {
  const workspaces = expect(await connection.workspace.getWorkspaceFolders(), 'workspace must be open for event to occur')
  if (workspaces == null) { return }
  for (const change of changes) {
    const workspaceChanged = expect(workspaces.find((workspace) => change.uri.startsWith(workspace.uri)), 'file must exist in workspace')
    console.log(`changed: ${workspaceChanged.uri}`)
    if (!workspaceRepos.has(workspaceChanged.uri)) {
      await createRepoForWorkspace(workspaceChanged)
      return
    }
    const repoChanged = expect(workspaceRepos.get(workspaceChanged.uri), 'already returned if key missing')
    repoChanged.processChange(change)
    // connection.sendDiagnostics({
    //   uri: change.uri,
    //   diagnostics: [
    //     generateDiagnostic(
    //       DiagnosticSeverity.Error,
    //       {line: 1, character: 1},
    //       {line: 1, character: 2},
    //       `test`,
    //       change.uri
    //     )
    //   ]
    // })
  }
  await connection.sendRequest('onDidChangeWatchedFiles')
})

connection.onRequest('onDidChangeWorkspaceFolders', async (event) => {
  console.log('workspace event')
  for (const workspace of event.removed) {
    removeRepoForWorkspace(workspace)
  }
  for (const workspace of event.added) {
    await createRepoForWorkspace(workspace)
  }
})
connection.onRequest('echo', message => message)
connection.onRequest('repo-trees', async ({ workspaceUri }) => {
  const repo = workspaceRepos.get(workspaceUri)
  if (repo == null) { return null }
  const trees = await Promise.all(repo.collections().map(async collection => await repo.collectionTree(collection)))
  return trees
})
connection.onRequest('repo-orphan-modules', async ({ workspaceUri, asTreeObjects }) => {
  const repo = workspaceRepos.get(workspaceUri)
  if (repo == null) { return null }
  const orphanModules = await repo.orphanModules()
  const result = asTreeObjects ? await Promise.all(orphanModules.map(async m => await repo.moduleAsTreeObject(m))) : orphanModules
  return result
})
connection.onRequest('repo-modules', async ({ workspaceUri, asTreeObjects }) => {
  const repo = workspaceRepos.get(workspaceUri)
  if (repo == null) { return null }
  const modules = repo.modules()
  const result = asTreeObjects ? await Promise.all(modules.map(async m => await repo.moduleAsTreeObject(m))) : modules
  return result
})

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection)

// Listen on the connection
connection.listen()
