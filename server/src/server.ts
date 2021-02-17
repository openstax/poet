import {
  createConnection,
  TextDocuments,
  Diagnostic,
  DiagnosticSeverity,
  ProposedFeatures,
  InitializeParams,
  TextDocumentSyncKind,
  InitializeResult
} from 'vscode-languageserver/node'

import xpath from 'xml2js-xpath'
import { parseStringPromise } from 'xml2js'
import {
  URI
} from 'vscode-uri'
import {
  TextDocument
} from 'vscode-languageserver-textdocument'
import fs from 'fs'
import path from 'path'

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
  await validateImagePaths(textDocument)
})

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection)

// Listen on the connection
connection.listen()

async function validateImagePaths(textDocument: TextDocument): Promise<void> {
  const text = textDocument.getText()
  const diagnostics: Diagnostic[] = []
  const diagnosticSource = 'Image validation'
  let images = []

  try {
    const xmlData = await parseStringPromise(text)
    images = xpath.find(xmlData, '//image')
  } catch {
    // Send an error that the validator can't parse file as XML
    const diagnostic: Diagnostic = {
      severity: DiagnosticSeverity.Error,
      range: {
        start: textDocument.positionAt(0),
        end: textDocument.positionAt(0)
      },
      message: `Cannot parse ${textDocument.uri} as valid XML`,
      source: diagnosticSource
    }
    diagnostics.push(diagnostic)
  }

  for (const image of images) {
    const imageSrc = image.$.src
    const documentPath = URI.parse(textDocument.uri).path
    // The image path is relative to the document
    const imagePath = path.join(path.dirname(documentPath), imageSrc)
    // Track the location of the image path in the text for diagnostic range
    const imageLocation = text.indexOf(imageSrc)

    if (fs.existsSync(imagePath)) {
      continue
    }
    const diagnostic: Diagnostic = {
      severity: DiagnosticSeverity.Error,
      range: {
        start: textDocument.positionAt(imageLocation),
        end: textDocument.positionAt(imageLocation + parseInt(imageSrc.length))
      },
      message: `Image file ${String(imageSrc)} doesn't exist!`,
      source: diagnosticSource
    }
    diagnostics.push(diagnostic)
  }

  connection.sendDiagnostics({ uri: textDocument.uri, diagnostics })
}
