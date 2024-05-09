import path from 'path'
import type I from 'immutable'
import * as xpath from 'xpath-ts'
import { type PageNode } from './page'
import { type Factory } from './factory'
import { type ResourceNode } from './resource'
import { type H5PExercise } from './h5p-exercise'

export const NS_COLLECTION = 'http://cnx.rice.edu/collxml'
const NS_CNXML = 'http://cnx.rice.edu/cnxml'
export const NS_METADATA = 'http://cnx.rice.edu/mdml'
const NS_CONTAINER = 'https://openstax.org/namespaces/book-container'

const NOWHERE_START: Position = { line: 0, character: 0 }
const NOWHERE_END: Position = { line: 0, character: 0 /* Number.MAX_VALUE */ }
export const NOWHERE: Range = { start: NOWHERE_START, end: NOWHERE_END }

export const select = xpath.useNamespaces({ cnxml: NS_CNXML, col: NS_COLLECTION, md: NS_METADATA, bk: NS_CONTAINER })
export const selectOne = (sel: string, doc: Node): Element => {
  const ret = select(sel, doc) as Node[]
  expectValue(ret.length === 1 || null, `ERROR: Expected one but found ${ret.length} results that match '${sel}'`)
  return ret[0] as Element
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
  canonicalize: (p: T) => T
}

export interface Range {
  readonly start: Position
  readonly end: Position
}

export interface WithRange<T> extends HasRange {
  v: T
}
export interface HasRange {
  range: Range
}

export function textWithRange(el: Element, attr?: string): WithRange<string> {
  const range = calculateElementPositions(el)
  const v = attr !== undefined ? el.getAttribute(attr) : el.textContent
  return {
    v: expectValue(v, `BUG: Element/Attribute does not have a value. ${JSON.stringify(range.start)}`),
    range
  }
}

// This also exists in ../common/
export enum TocNodeKind {
  Subbook = 'TocNodeKind.Subbook',
  Page = 'TocNodeKind.Page'
}
export type TocNode<T> = TocSubbook<T> | TocPage<T>
export interface TocSubbook<T> { type: TocNodeKind.Subbook, readonly title: string, readonly children: Array<TocNode<T>> }
export interface TocPage<T> { type: TocNodeKind.Page, readonly page: T }

export interface Paths {
  booksRoot: string
  pagesRoot: string
  mediaRoot: string
  privateRoot: string
  publicRoot: string
}

export interface Bundleish {
  allPages: Factory<PageNode>
  allResources: Factory<ResourceNode>
  allH5P: Factory<H5PExercise>
  workspaceRootUri: string
  isDuplicateUuid: (uuid: string) => boolean
  isDuplicateResourcePath: (path: string) => boolean
  paths: Paths
}

export enum PathKind {
  ABS_TO_REL = 'REL_TO_REL',
  COLLECTION_TO_MODULEID = 'COLLECTION_TO_MODULEID',
  MODULE_TO_MODULEID = 'MODULE_TO_MODULEID',
}

export function join(helper: PathHelper<string>, type: PathKind, parent: string, child: string) {
  const { dirname, join } = helper
  let p
  let c
  switch (type) {
    case PathKind.ABS_TO_REL: p = dirname(parent); c = child; break
    case PathKind.COLLECTION_TO_MODULEID: p = dirname(dirname(parent)); c = /* relative_path */path.join('modules', child, 'index.cnxml'); break
    case PathKind.MODULE_TO_MODULEID: p = dirname(dirname(parent)); c = /* relative_path */path.join(child, 'index.cnxml'); break
  }
  return join(p, c)
}

export function findDuplicates<T>(list: I.List<T>) {
  return list.filter((item, index) => index !== list.indexOf(item))
}

export function calculateElementPositions(element: any): Range {
  // Calculate positions accounting for the zero-based convention used by
  // vscode
  const start: Position = {
    line: element.lineNumber - 1,
    character: element.columnNumber - 1
  }
  const elementSibling = element.nextSibling
  let end: Position

  // Establish the end position using as much information as possible
  // based upon (in order of preference) 1) element sibling 2) final element
  // attribute 3) the tag
  if (elementSibling != null) {
    end = {
      line: element.nextSibling.lineNumber - 1,
      character: element.nextSibling.columnNumber - 1
    }
  } else if (element.attributes.length > 0) {
    const elementAttributes = element.attributes
    const finalAttribute = elementAttributes[elementAttributes.length - 1]
    const finalAttributeColumn: number = finalAttribute.columnNumber
    const finalAttributeLength: number = finalAttribute.value.length

    end = {
      line: finalAttribute.lineNumber - 1,
      character: finalAttributeColumn + finalAttributeLength + 1
    }
  } else {
    const elementTag = element.tagName
    const tagLength: number = elementTag.length
    const elementStartColumn: number = element.columnNumber

    end = {
      line: element.lineNumber - 1,
      character: elementStartColumn + tagLength
    }
  }

  return { start, end }
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

function isAfter(a: Position, b: Position) {
  if (a.line === b.line) {
    return a.character > b.character
  }
  return a.line > b.line
}

function isBeforeOrEqual(a: Position, b: Position) {
  if (a.line === b.line) {
    return a.character <= b.character
  }
  return a.line < b.line
}

export function inRange(range: Range, current: Position) {
  return (isAfter(current, range.start) && isBeforeOrEqual(current, range.end))
}
export const equalsOpt = <T>(eq: (n1: T, n2: T) => boolean) => (n1: Opt<T>, n2: Opt<T>) => {
  /* istanbul ignore next */
  return n1 === undefined ? n2 === undefined : n2 === undefined ? false : eq(n1, n2)
}
export const equalsWithRange = <T>(eq: (n1: T, n2: T) => boolean) => (n1: WithRange<T>, n2: WithRange<T>) => {
  return equalsPos(n1.range.start, n2.range.start) && equalsPos(n1.range.end, n2.range.end) && eq(n1.v, n2.v)
}
export const equalsArray = <T>(eq: (n1: T, n2: T) => boolean) => (n1: T[], n2: T[]) => {
  /* istanbul ignore else */
  if (n1.length === n2.length) {
    for (let i = 0; i < n1.length; i++) {
      /* istanbul ignore else */
      if (!eq(n1[i], n2[i])) {
        return false
      }
    }
    /* istanbul ignore next */
    return true
  }
  /* istanbul ignore next */
  return false
}
export const tripleEq = <T>(n1: T, n2: T) => {
  return n1 === n2
}
export const equalsPos = (n1: Position, n2: Position) => {
  return n1.line === n2.line && n1.character === n2.character
}
