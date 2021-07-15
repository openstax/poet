import {
  Diagnostic,
  DiagnosticSeverity,
  Position
} from 'vscode-languageserver/node'
import fs from 'fs'
import * as xpath from 'xpath-ts'
import { DOMParser } from 'xmldom'
import { URI } from 'vscode-uri'

const SOURCE = 'cnxml'

export const NS_COLLECTION = 'http://cnx.rice.edu/collxml'
export const NS_CNXML = 'http://cnx.rice.edu/cnxml'
export const NS_METADATA = 'http://cnx.rice.edu/mdml'

export const select = xpath.useNamespaces({ cnxml: NS_CNXML, col: NS_COLLECTION, md: NS_METADATA })

export function generateDiagnostic(severity: DiagnosticSeverity,
  startPosition: Position, endPosition: Position, message: string,
  diagnosticCode: string): Diagnostic {
  const diagnostic: Diagnostic = {
    severity: severity,
    range: {
      start: startPosition,
      end: endPosition
    },
    message: message,
    source: SOURCE,
    code: diagnosticCode
  }
  return diagnostic
}

export function matchElement(documentURI: string, position: Position, xpath: string): void {
  const doc = URI.parse(documentURI)
  const file = fs.readFileSync(doc.fsPath, { encoding: 'utf-8' })
  const p = new DOMParser()
  const dom = p.parseFromString(file)

  const potentialMatches = select(xpath, dom) as any[]

  console.log(position)

  console.log('matches')
  const elementMatches = potentialMatches.filter((element) => {
    const srcAttr = element.attributes.getNamedItem('src')
    return srcAttr.lineNumber === position.line + 1
    // return position.line >= element.lineNumber && position.line < element.nextSibling?.lineNumber
  })

  //console.log(`${element.attributes[0].lineNumber as string}, ${element.attributes[0].columnNumber as string}`)
  // const idAttr = dom.documentElement.firstChild.attributes[0]
  // console.log(idAttr.lineNumber, idAttr.columnNumber)
  console.log(elementMatches)
}

export function calculateElementPositions(element: any): Position[] {
  // Calculate positions accounting for the zero-based convention used by
  // vscode
  const startPosition: Position = {
    line: element.lineNumber - 1,
    character: element.columnNumber - 1
  }
  const elementSibling = element.nextSibling
  let endPosition: Position

  // Establish the end position using as much information as possible
  // based upon (in order of preference) 1) element sibling 2) final element
  // attribute 3) the tag
  if (elementSibling != null) {
    endPosition = {
      line: element.nextSibling.lineNumber - 1,
      character: element.nextSibling.columnNumber - 1
    }
  } else if (element.attributes.length > 0) {
    const elementAttributes = element.attributes
    const finalAttribute = elementAttributes[elementAttributes.length - 1]
    const finalAttributeColumn: number = finalAttribute.columnNumber
    const finalAttributeLength: number = finalAttribute.value.length

    endPosition = {
      line: finalAttribute.lineNumber - 1,
      character: finalAttributeColumn + finalAttributeLength + 1
    }
  } else {
    const elementTag = element.tagName
    const tagLength: number = elementTag.length
    const elementStartColumn: number = element.columnNumber

    endPosition = {
      line: element.lineNumber - 1,
      character: elementStartColumn + tagLength
    }
  }

  return [startPosition, endPosition]
}

/**
 * Asserts a value of a nullable type is not null and returns the same value with a non-nullable type
 */
export function expect<T>(value: T | null | undefined, message: string): T {
  if (value == null) {
    throw new Error(message)
  }
  return value
}

export const fileExistsAt = async (filepath: string): Promise<boolean> => {
  let exists = true
  try {
    const stat = await fs.promises.stat(filepath)
    exists = stat.isFile()
  } catch (err) {
    exists = false
  }
  return exists
}
