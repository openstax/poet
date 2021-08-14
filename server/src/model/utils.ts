import I from 'immutable'
import * as xpath from 'xpath-ts'
import { PageNode } from './page'
import { Factory } from './factory'
import { ImageNode } from './image'

const NS_COLLECTION = 'http://cnx.rice.edu/collxml'
const NS_CNXML = 'http://cnx.rice.edu/cnxml'
const NS_METADATA = 'http://cnx.rice.edu/mdml'
const NS_CONTAINER = 'https://openstax.org/namespaces/book-container'

export const NOWHERE_START: Position = { line: 0, character: 0 }
export const NOWHERE_END: Position = { line: 0, character: 0 /* Number.MAX_VALUE */ }

export const select = xpath.useNamespaces({ cnxml: NS_CNXML, col: NS_COLLECTION, md: NS_METADATA, bk: NS_CONTAINER })
export const selectOne = <T extends Node>(sel: string, doc: Node): T => {
  const ret = select(sel, doc) as Node[]
  expectValue(ret.length === 1 || null, `ERROR: Expected one but found ${ret.length} results that match '${sel}'`)
  return ret[0] as T
}

export type Opt<T> = T | undefined

// This matches the signature of vscode-languageserver-textdocument.Position without needing to import it
export interface Position {
  line: number // 0-based
  character: number // 0-based
}

// path.join mangles URIs (converts from file:///foo to file:/foo)
export interface PathHelper<T> {
  join: (root: T, ...components: string[]) => T
  dirname: (p: T) => T
}

export interface Source {
  startPos: Position
  endPos: Position
}

export interface WithSource<T> extends Source {
  v: T
}

export function textWithSource(el: Element, attr?: string): WithSource<string> {
  const [startPos, endPos] = calculateElementPositions(el)
  const v = attr !== undefined ? el.getAttribute(attr) : el.textContent
  return {
    v: expectValue(v, `BUG: Element/Attribute does not have a value. ${JSON.stringify(startPos)}`),
    startPos,
    endPos
  }
}

export interface Bundleish {
  allPages: Factory<PageNode>
  allImages: Factory<ImageNode>
  workspaceRoot: string
  isDuplicateUuid: (uuid: string) => boolean
}

export enum PathType {
  ABS_TO_REL = 'REL_TO_REL',
  COLLECTION_TO_MODULEID = 'COLLECTION_TO_MODULEID',
  MODULE_TO_MODULEID = 'MODULE_TO_MODULEID',
}

export function findDuplicates<T>(list: I.List<T>) {
  return list.filter((item, index) => index !== list.indexOf(item))
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
export function expectValue<T>(value: T | null | undefined, message: string): T {
  if (value == null) {
    throw new Error(message)
  }
  return value
}

export async function profileAsync<T>(fn: () => Promise<T>) {
  const start = Date.now()
  const ret = await fn()
  return [Date.now() - start, ret]
}
