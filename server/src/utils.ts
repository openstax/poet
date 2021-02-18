import { Diagnostic, DiagnosticSeverity, Position } from 'vscode-languageserver/node'
import {
  TextDocument
} from 'vscode-languageserver-textdocument'
import { parseStringPromise } from 'xml2js'
import xpath from 'xml2js-xpath'
import {
  URI
} from 'vscode-uri'
import fs from 'fs'
import path from 'path'

export const IMAGEPATH_DIAGNOSTIC_SOURCE = 'Image validation'

export async function parseXMLString(textDocument: TextDocument): Promise<any> {
  try {
    const text = textDocument.getText()
    const xmlData = await parseStringPromise(text)
    return xmlData
  } catch {
    return null
  }
}

export async function validateImagePaths(textDocument: TextDocument, xmlData: any): Promise<Diagnostic[]> {
  const text = textDocument.getText()
  const diagnostics: Diagnostic[] = []
  const images = xpath.find(xmlData, '//image')

  for (const image of images) {
    // Ignore if this image doesn't have attributes or src (e.g. if it is
    // being edited).
    const imageSrc = image !== '' && 'src' in image.$ ? image.$.src : null
    if (imageSrc == null) {
      continue
    }

    const documentPath = URI.parse(textDocument.uri).path
    // The image path is relative to the document
    const imagePath = path.join(path.dirname(documentPath), imageSrc)
    // Track the location of the image path in the text for diagnostic range
    const imageLocation = text.indexOf(imageSrc)

    if (fs.existsSync(imagePath)) {
      continue
    }
    const diagnostic: Diagnostic = generateDiagnostic(
      DiagnosticSeverity.Error,
      textDocument.positionAt(imageLocation),
      textDocument.positionAt(imageLocation + parseInt(imageSrc.length)),
      `Image file ${String(imageSrc)} doesn't exist!`,
      IMAGEPATH_DIAGNOSTIC_SOURCE
    )
    diagnostics.push(diagnostic)
  }

  return diagnostics
}

function generateDiagnostic(severity: DiagnosticSeverity,
  startPosition: Position, endPosition: Position, message: string,
  diagnosticSource: string): Diagnostic {
  const diagnostic: Diagnostic = {
    severity: severity,
    range: {
      start: startPosition,
      end: endPosition
    },
    message: message,
    source: diagnosticSource
  }
  return diagnostic
}
