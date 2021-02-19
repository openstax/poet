import { Diagnostic, DiagnosticSeverity, Position } from 'vscode-languageserver/node'
import {
  TextDocument
} from 'vscode-languageserver-textdocument'
import { DOMParser } from 'xmldom'
import * as xpath from 'xpath-ts'
import {
  URI
} from 'vscode-uri'
import fs from 'fs'
import path from 'path'

const NS_CNXML = 'http://cnx.rice.edu/cnxml'
export const IMAGEPATH_DIAGNOSTIC_SOURCE = 'Image validation'

export function parseXMLString(textDocument: TextDocument): Document | null {
  const text = textDocument.getText()
  const xmlData: Document = new DOMParser().parseFromString(text)
  if (xmlData === undefined) {
    return null
  }
  return xmlData
}

export async function validateImagePaths(textDocument: TextDocument, xmlData: Document): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = []

  const select = xpath.useNamespaces({ cnxml: NS_CNXML })
  const images = select('//cnxml:image[@src]', xmlData) as Node[]

  for (const image of images) {
    const imageElement = image as any
    const imageSrc = imageElement.getAttribute('src')
    if (imageSrc == null) {
      continue
    }

    const documentPath = URI.parse(textDocument.uri).path
    // The image path is relative to the document
    const imagePath = path.join(path.dirname(documentPath), imageSrc)
    // Track the location of the image path in the text for diagnostic range
    const startPosition: Position = {
      line: imageElement.lineNumber - 1,
      character: imageElement.columnNumber - 1
    }
    const endPosition: Position = {
      line: imageElement.nextSibling.lineNumber - 1,
      character: imageElement.nextSibling.columnNumber - 1
    }

    if (fs.existsSync(imagePath)) {
      continue
    }
    const diagnostic: Diagnostic = generateDiagnostic(
      DiagnosticSeverity.Error,
      startPosition,
      endPosition,
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
