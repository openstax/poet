import {
  Diagnostic,
  DiagnosticSeverity,
  Position
} from 'vscode-languageserver/node'
import fs from 'fs'
import Immutable from 'immutable'
import * as Quarx from 'quarx'

const SOURCE = 'cnxml'

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

export function calculateElementPositions(element: any): [Position, Position] {
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

export const fileExistsAtSync = (filepath: string): boolean => {
  let exists = true
  try {
    const stat = fs.statSync(filepath)
    exists = stat.isFile()
  } catch (err) {
    exists = false
  }
  return exists
}

export function getOrAdd<K, V>(boxedMap: Quarx.Box<Immutable.Map<K, V>>, key: K, newInstance: () => V): V {
  const m = boxedMap.get()
  const v = m.get(key)
  if (v !== undefined) {
    return v
  } else {
    const i = newInstance()
    boxedMap.set(m.set(key, i))
    return i
  }
}

export function profile(fn: () => void): number {
  const start = Date.now()
  fn()
  return Date.now() - start
}