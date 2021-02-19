import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  TextDocumentSyncKind,
  InitializeResult,
  Diagnostic
} from 'vscode-languageserver/node'

import {
  TextDocument
} from 'vscode-languageserver-textdocument'

import {
  getCurrentModules,
  parseXMLString,
  validateImagePaths,
  validateLinks
} from './utils'

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all)

// Create a simple text document manager.
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument)

connection.onInitialize((params: InitializeParams) => {
  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: {
        // Get notifications when documents are opened / closed and also
        // for content changes using incremental updates
        openClose: true,
        change: TextDocumentSyncKind.Incremental
      }
    }
  }
  return result
})

connection.onInitialized(() => {
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
  let workspaceFolders = await connection.workspace.getWorkspaceFolders()
  if (workspaceFolders == null) {
    workspaceFolders = []
  }
  const diagnostics: Diagnostic[] = []
  const xmlData = parseXMLString(textDocument)
  // FIXME: Querying known modules here temporarily, but this will get removed
  // in a subsequent commit to make it event based
  const knownModules = await getCurrentModules(workspaceFolders)

  if (xmlData != null) {
    const imagePathDiagnostics = await validateImagePaths(textDocument, xmlData)
    diagnostics.push(...imagePathDiagnostics)
    const linkDiagnostics = await validateLinks(xmlData, knownModules)
    diagnostics.push(...linkDiagnostics)
  }

  connection.sendDiagnostics({
    uri: textDocument.uri,
    diagnostics
  })
})

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection)

// Listen on the connection
connection.listen()
