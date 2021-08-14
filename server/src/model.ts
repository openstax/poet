import path from 'path'
import I from 'immutable'
import * as xpath from 'xpath-ts'
import { DOMParser } from 'xmldom'
import { calculateElementPositions, expect } from './utils'

const LOAD_ERROR = 'Object has not been loaded yet'

const NS_COLLECTION = 'http://cnx.rice.edu/collxml'
const NS_CNXML = 'http://cnx.rice.edu/cnxml'
const NS_METADATA = 'http://cnx.rice.edu/mdml'
const NS_CONTAINER = 'https://openstax.org/namespaces/book-container'

const NOWHERE_START: Position = { line: 0, character: 0 }
const NOWHERE_END: Position = { line: 0, character: 0 /* Number.MAX_VALUE */ }

const select = xpath.useNamespaces({ cnxml: NS_CNXML, col: NS_COLLECTION, md: NS_METADATA, bk: NS_CONTAINER })
const selectOne = <T extends Node>(sel: string, doc: Node): T => {
  const ret = select(sel, doc) as Node[]
  expect(ret.length === 1 || null, `ERROR: Expected one but found ${ret.length} results that match '${sel}'`)
  return ret[0] as T
}

function filterNull<T>(set: I.Set<Opt<T>>): I.Set<T> {
  return I.Set<T>().withMutations(s => {
    set.forEach(s1 => {
      if (s1 !== undefined) {
        s.add(s1)
      }
    })
  })
}

export type Opt<T> = T | undefined

// This matches the signature of vscode-languageserver-textdocument.Position without needing to import it
export interface Position {
  line: number // 0-based
  character: number // 0-based
}

export class ModelError extends Error {
  constructor(public readonly node: Fileish, message: string, public readonly startPos: Position, public readonly endPos: Position) {
    super(message)
    this.name = this.constructor.name
  }
}
export class ParseError extends ModelError { }
export class WrappedParseError<T extends Error> extends ParseError {
  constructor(node: Fileish, originalError: T) {
    super(node, originalError.message, NOWHERE_START, NOWHERE_END)
  }
}

interface ValidationCheck {
  message: string
  nodesToLoad: I.Set<Fileish>
  fn: (loadedNodes?: I.Set<Fileish>) => I.Set<Source>
}
export class ValidationResponse {
  constructor(public readonly errors: I.Set<ModelError>, public readonly nodesToLoad: I.Set<Fileish> = I.Set()) {}

  static continueOnlyIfLoaded(nodes: I.Set<Fileish>, next: (nodes: I.Set<Fileish>) => I.Set<ModelError>) {
    const unloaded = nodes.filter(n => !n.isLoaded())
    if (unloaded.size > 0) {
      return new ValidationResponse(I.Set(), unloaded)
    } else {
      return new ValidationResponse(next(nodes))
    }
  }
}

// path.join mangles URIs (converts from file:///foo to file:/foo)
export interface PathHelper<T> {
  join: (root: T, ...components: string[]) => T
  dirname: (p: T) => T
}

export abstract class Fileish {
  private _isLoaded = false
  private _exists = false
  private _parseError: Opt<ParseError>
  protected parseXML: Opt<(doc: Document) => void> // Subclasses define this
  protected childrenToLoad: Opt<() => I.Set<Fileish>> // Subclasses define this

  constructor(private _bundle: Opt<Bundle>, protected _pathHelper: PathHelper<string>, public readonly absPath: string) { }

  static debug = (...args: any[]) => {} // console.debug
  protected abstract getValidationChecks(): ValidationCheck[]
  public isLoaded() { return this._isLoaded }
  public filePath() { return path.relative(this.bundle().workspaceRoot, this.absPath) }
  protected setBundle(bundle: Bundle) { this._bundle = bundle /* avoid catch-22 */ }
  protected bundle() { return expect(this._bundle, 'BUG: This object was not instantiated with a Bundle. The only case that should occur is when this is a Bundle object') }
  protected ensureLoaded<T>(field: Opt<T>) {
    return expect(field, `${LOAD_ERROR} [${this.absPath}]`)
  }

  public exists() { return this._exists }
  public update(fileContent: Opt<string>): void {
    Fileish.debug(this.filePath, 'update() started')
    this._parseError = undefined
    if (fileContent === undefined) {
      this._exists = false
      this._isLoaded = true
      return
    }
    if (this.parseXML !== undefined) {
      Fileish.debug(this.filePath, 'parsing XML')

      // Development version throws errors instead of turning them into messages
      const parseXML = this.parseXML
      const fn = () => {
        const doc = this.readXML(fileContent)
        if (this._parseError !== undefined) return
        parseXML(doc)
        this._isLoaded = true
        this._exists = true
      }
      if (process.env.NODE_ENV !== 'production') {
        fn()
      } else {
        try {
          fn()
        } catch (e) {
          this._parseError = new WrappedParseError(this, e)
        }
      }
      Fileish.debug(this.filePath, 'parsing XML (done)')
    } else {
      this._exists = true
      this._isLoaded = true
    }
    Fileish.debug(this.filePath, 'update done')
  }

  // Update this Node, and collect all Parse errors
  public load(fileContent: Opt<string>) {
    Fileish.debug(this.filePath, 'load started')
    this.update(fileContent)
    Fileish.debug(this.filePath, 'load done')
  }

  private readXML(fileContent: string) {
    const locator = { lineNumber: 0, columnNumber: 0 }
    const cb = (msg: string) => {
      const pos = {
        line: locator.lineNumber - 1,
        character: locator.columnNumber - 1
      }
      this._parseError = new ParseError(this, msg, pos, pos)
    }
    const p = new DOMParser({
      locator,
      errorHandler: {
        warning: console.warn,
        error: cb,
        fatalError: cb
      }
    })
    const doc = p.parseFromString(fileContent)
    return doc
  }

  public getValidationErrors(): ValidationResponse {
    if (this._parseError !== undefined) {
      return new ValidationResponse(I.Set([this._parseError]))
    } else if (!this._isLoaded) {
      return new ValidationResponse(I.Set(), I.Set([this]))
    } else if (!this._exists) {
      return new ValidationResponse(I.Set(), I.Set())
    } else {
      const responses = this.getValidationChecks().map(c => ValidationResponse.continueOnlyIfLoaded(c.nodesToLoad, () => toValidationErrors(this, c.message, c.fn(c.nodesToLoad))))
      const nodesToLoad = I.Set(responses.map(r => r.nodesToLoad)).flatMap(x => x)
      const errors = I.Set(responses.map(r => r.errors)).flatMap(x => x)
      return new ValidationResponse(errors, nodesToLoad)
    }
  }

  join(type: PathType, parent: string, child: string) {
    const { dirname, join } = this._pathHelper
    let p
    let c
    switch (type) {
      case PathType.ABS_TO_REL: p = dirname(parent); c = child; break
      case PathType.COLLECTION_TO_MODULEID: p = dirname(dirname(parent)); c = /* relative_path */path.join('modules', child, 'index.cnxml'); break
      case PathType.MODULE_TO_MODULEID: p = dirname(dirname(parent)); c = /* relative_path */path.join(child, 'index.cnxml'); break
    }
    return join(p, c)
  }
}

export interface Source {
  startPos: Position
  endPos: Position
}

export interface WithSource<T> extends Source {
  v: T
}

export interface ImageLink extends Source {
  image: ImageNode
}

export interface PageLink extends Source {
  page: Opt<PageNode>
  targetElementId: Opt<string>
  url: Opt<string>
}

function textWithSource(el: Element, attr?: string): WithSource<string> {
  const [startPos, endPos] = calculateElementPositions(el)
  const v = attr !== undefined ? el.getAttribute(attr) : el.textContent
  return {
    v: expect(v, `BUG: Element/Attribute does not have a value. ${JSON.stringify(startPos)}`),
    startPos,
    endPos
  }
}

export class ImageNode extends Fileish {
  /* istanbul ignore next */
  public getValidationChecks() { return [] }
}

function convertToPos(str: string, cursor: number): Position {
  const lines = str.substring(cursor).split('\n')
  return { line: lines.length, character: lines[lines.length - 1].length }
}
function toValidationErrors(node: Fileish, message: string, sources: I.Set<Source>) {
  return sources.map(s => new ModelError(node, message, s.startPos, s.endPos))
}

export enum PageValidationKind {
  MISSING_IMAGE = 'Missing image',
  MISSING_TARGET = 'Link target not found',
  MALFORMED_UUID = 'Malformed UUID',
  DUPLICATE_UUID = 'Duplicate Page/Module UUID',
}
export const UNTITLED_FILE = 'UntitledFile'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export class PageNode extends Fileish {
  private _uuid: Opt<WithSource<string>>
  private _title: Opt<WithSource<string>>
  private _elementIds: Opt<I.Set<WithSource<string>>>
  private _imageLinks: Opt<I.Set<ImageLink>>
  private _pageLinks: Opt<I.Set<PageLink>>
  public uuid() { return this.ensureLoaded(this._uuid).v }
  public title(fileReader: () => string) {
    // A quick way to get the title for the ToC
    if (this._title === undefined) {
      const data = fileReader()
      return this.guessTitle(data)?.v ?? UNTITLED_FILE
    }
    return this._title.v
  }

  private guessTitle(data: string): Opt<WithSource<string>> {
    const openTag = '<title>'
    const closeTag = '</title>'
    const titleTagStart = data.indexOf(openTag)
    const titleTagEnd = data.indexOf(closeTag)
    if (titleTagStart === -1 || titleTagEnd === -1) {
      return
    }
    const actualTitleStart = titleTagStart + openTag.length
    /* istanbul ignore if */
    if (titleTagEnd - actualTitleStart > 280) {
      // If the title is so long you can't tweet it,
      // then something probably went wrong.
      /* istanbul ignore next */
      return
    }
    return {
      v: data.substring(actualTitleStart, titleTagEnd).trim(),
      startPos: convertToPos(data, actualTitleStart),
      endPos: convertToPos(data, titleTagEnd)
    }
  }

  public imageLinks() {
    return this.ensureLoaded(this._imageLinks)
  }

  public pageLinks() {
    return this.ensureLoaded(this._pageLinks)
  }

  public hasElementId(id: string) {
    return this.ensureLoaded(this._elementIds).toSeq().find(n => n.v === id) !== undefined
  }

  protected childrenToLoad = () => this.imageLinks().map(l => l.image)
  protected parseXML = (doc: Document) => {
    this._uuid = textWithSource(selectOne('//md:uuid', doc))

    this._elementIds = I.Set((select('//cnxml:*[@id]', doc) as Element[]).map(el => textWithSource(el, 'id')))

    const imageNodes = select('//cnxml:image/@src', doc) as Attr[]
    this._imageLinks = I.Set(imageNodes.map(attr => {
      const src = expect(attr.nodeValue, 'BUG: Attribute does not have a value')
      const image = super.bundle().allImages.get(this.join(PathType.ABS_TO_REL, this.absPath, src))
      // Get the line/col position of the <image> tag
      const imageNode = expect(attr.ownerElement, 'BUG: attributes always have a parent element')
      const [startPos, endPos] = calculateElementPositions(imageNode)
      return { image, startPos, endPos }
    }))

    const linkNodes = select('//cnxml:link', doc) as Element[]
    const changeEmptyToNull = (str: string | null): Opt<string> => (str === '' || str === null) ? undefined : str
    this._pageLinks = I.Set(linkNodes.map(linkNode => {
      const [startPos, endPos] = calculateElementPositions(linkNode)
      // xmldom never returns null, it returns ''
      const toDocument = changeEmptyToNull(linkNode.getAttribute('document'))
      const toTargetId = changeEmptyToNull(linkNode.getAttribute('target-id'))
      const toUrl = changeEmptyToNull(linkNode.getAttribute('url'))
      return {
        page: toDocument !== undefined ? super.bundle().allPages.get(this.join(PathType.MODULE_TO_MODULEID, this.absPath, toDocument)) : (toTargetId !== undefined ? this : undefined),
        url: toUrl,
        targetElementId: toTargetId,
        startPos,
        endPos
      }
    }))

    const titleNode = select('//cnxml:title', doc) as Element[]
    if (titleNode.length > 0) {
      this._title = textWithSource(titleNode[0])
    } else {
      this._title = {
        v: UNTITLED_FILE,
        startPos: NOWHERE_START,
        endPos: NOWHERE_END
      }
    }
  }

  public getValidationChecks(): ValidationCheck[] {
    const imageLinks = this.imageLinks()
    const pageLinks = this.pageLinks()
    return [
      {
        message: PageValidationKind.MISSING_IMAGE,
        nodesToLoad: imageLinks.map(l => l.image),
        fn: () => imageLinks.filter(img => !img.image.exists())
      },
      {
        message: PageValidationKind.MISSING_TARGET,
        nodesToLoad: filterNull(pageLinks.map(l => l.page)),
        fn: () => pageLinks.filter(l => {
          if (l.page === undefined) return false // URL links are ok
          if (!l.page.exists()) return true // link to non-existent page are bad
          if (l.targetElementId === undefined) return false // linking to the whole page and it exists is ok
          return !l.page.hasElementId(l.targetElementId)
        })
      },
      {
        message: PageValidationKind.MALFORMED_UUID,
        nodesToLoad: I.Set(),
        fn: () => {
          const uuid = this.ensureLoaded(this._uuid)
          return UUID_RE.test(uuid.v) ? I.Set() : I.Set([uuid])
        }
      },
      {
        message: PageValidationKind.DUPLICATE_UUID,
        nodesToLoad: I.Set(),
        fn: () => {
          const uuid = this.ensureLoaded(this._uuid)
          if (this.bundle().isDuplicateUuid(uuid.v)) {
            return I.Set([uuid])
          } else {
            return I.Set()
          }
        }
      }
    ]
  }
}

export enum TocNodeType {
  Inner,
  Leaf
}
export type TocNode = TocInner | TocLeaf
interface TocInner extends Source { readonly type: TocNodeType.Inner, readonly title: string, readonly children: TocNode[] }
interface TocLeaf extends Source { readonly type: TocNodeType.Leaf, readonly page: PageNode }

export class BookNode extends Fileish {
  private _title: Opt<WithSource<string>>
  private _slug: Opt<WithSource<string>>
  private _toc: Opt<TocNode[]>

  protected childrenToLoad = () => I.Set(this.pages())
  protected parseXML = (doc: Document) => {
    this._title = textWithSource(selectOne('/col:collection/col:metadata/md:title', doc))
    this._slug = textWithSource(selectOne('/col:collection/col:metadata/md:slug', doc))
    const root: Element = selectOne('/col:collection/col:content', doc)
    this._toc = this.buildChildren(root)
  }

  private buildChildren(root: Element): TocNode[] {
    const ret = (select('./col:*', root) as Element[]).map((childNode): TocNode => {
      const [startPos, endPos] = calculateElementPositions(childNode)
      switch (childNode.localName) {
        case 'subcollection': {
          const titleNode = selectOne('md:title', childNode)
          const [startPos, endPos] = calculateElementPositions(titleNode)
          return {
            type: TocNodeType.Inner,
            title: expect(titleNode.textContent, 'ERROR: Malformed or missing md:title element in Subcollection'),
            children: this.buildChildren(selectOne('./col:content', childNode)),
            startPos,
            endPos
          }
        }
        case 'module': {
          const pageId = expect(selectOne('@document', childNode).nodeValue, 'BUG: missing @document on col:module')
          const page = super.bundle().allPages.get(this.join(PathType.COLLECTION_TO_MODULEID, this.absPath, pageId))
          return {
            type: TocNodeType.Leaf,
            page,
            startPos,
            endPos
          }
        }
        /* istanbul ignore next */
        default:
          /* istanbul ignore next */
          throw new Error(`ERROR: Unknown element in the ToC. '${childNode.localName}'`)
      }
    })
    return ret
  }

  public toc() {
    return this.ensureLoaded(this._toc)
  }

  public title() {
    return this.ensureLoaded(this._title).v
  }

  public slug() {
    return this.ensureLoaded(this._slug).v
  }

  public pages() {
    return this.tocLeaves().map(l => l.page)
  }

  private tocLeaves() {
    const toc = this.toc()
    return I.List<TocLeaf>().withMutations(acc => this.collectPages(toc, acc))
  }

  private collectPages(nodes: TocNode[], acc: I.List<TocLeaf>) {
    nodes.forEach(n => {
      if (n.type === TocNodeType.Leaf) { acc.push(n) } else { this.collectPages(n.children, acc) }
    })
  }

  private collectNonPages(nodes: TocNode[], acc: I.List<TocInner>) {
    nodes.forEach(n => {
      if (n.type !== TocNodeType.Leaf) {
        acc.push(n)
        this.collectNonPages(n.children, acc)
      }
    })
  }

  public getValidationChecks(): ValidationCheck[] {
    const pages = this.pages()
    const nonPages = I.List<TocInner>().withMutations(acc => this.collectNonPages(this.toc(), acc))
    const duplicateTitles = I.Set(findDuplicates(nonPages.map(subcol => subcol.title)))
    const pageLeaves = I.List<TocLeaf>().withMutations(acc => this.collectPages(this.toc(), acc))
    const duplicatePages = I.Set(findDuplicates(pages))
    return [
      {
        message: 'Missing page',
        nodesToLoad: I.Set(pages),
        fn: () => I.Set(this.tocLeaves()).filter(p => !p.page.exists())
      },
      {
        message: 'Duplicate chapter title',
        nodesToLoad: I.Set(),
        fn: () => I.Set(nonPages.filter(subcol => duplicateTitles.has(subcol.title)))
      },
      {
        message: 'Duplicate page',
        nodesToLoad: I.Set(),
        fn: () => I.Set(pageLeaves.filter(p => duplicatePages.has(p.page)))
      }
    ]
  }
}

export class Factory<T> {
  private _map = I.Map<string, T>()
  constructor(private readonly builder: (filePath: string) => T) { }
  getIfHas(filePath: string): Opt<T> {
    return this._map.get(filePath)
  }

  get(absPath: string) {
    const v = this._map.get(absPath)
    if (v !== undefined) {
      return v
    } else {
      const n = this.builder(absPath)
      this._map = this._map.set(absPath, n)
      return n
    }
  }

  public remove(filePath: string) {
    const item = this._map.get(filePath)
    this._map = this._map.delete(filePath)
    return item
  }

  public removeByKeyPrefix(pathPrefix: string) {
    const removedItems = this._map.filter((_, key) => key.startsWith(pathPrefix))
    this._map = this._map.filter((_, key) => !key.startsWith(pathPrefix))
    return I.Set(removedItems.values())
  }

  public all() { return I.Set(this._map.values()) }
}

export class Bundle extends Fileish {
  public readonly allImages = new Factory((absPath: string) => new ImageNode(this, this._pathHelper, absPath))
  public readonly allPages = new Factory((absPath: string) => new PageNode(this, this._pathHelper, absPath))
  public readonly allBooks = new Factory((absPath: string) => new BookNode(this, this._pathHelper, absPath))
  private _books: Opt<I.Set<WithSource<BookNode>>>

  constructor(pathHelper: PathHelper<string>, public readonly workspaceRoot: string) {
    super(undefined, pathHelper, pathHelper.join(workspaceRoot, 'META-INF/books.xml'))
    super.setBundle(this)
  }

  protected childrenToLoad = () => this.books()
  protected parseXML = (doc: Document) => {
    const bookNodes = select('//bk:book', doc) as Element[]
    this._books = I.Set(bookNodes.map(b => {
      const [startPos, endPos] = calculateElementPositions(b)
      const href = expect(b.getAttribute('href'), 'ERROR: Missing @href attribute on book element')
      const book = this.allBooks.get(this.join(PathType.ABS_TO_REL, this.absPath, href))
      return {
        v: book,
        startPos,
        endPos
      }
    }))
  }

  public allNodes() {
    return I.Set([this]).union(this.allBooks.all()).union(this.allPages.all()).union(this.allImages.all())
  }

  public books() {
    return this.__books().map(b => b.v)
  }

  private __books() {
    return this.ensureLoaded(this._books)
  }

  private gc() {
    // Remove any objects that don't exist and are not pointed to by a book
    // This may need to run every time an object is deleted (or exists is set to false)
  }

  public getValidationChecks(): ValidationCheck[] {
    const books = this.__books()
    return [
      {
        message: 'Missing book',
        nodesToLoad: this.books(),
        fn: () => books.filter(b => !b.v.exists())
      },
      {
        message: 'No books are defiend',
        nodesToLoad: I.Set(),
        fn: () => books.isEmpty() ? I.Set([{ startPos: NOWHERE_START, endPos: NOWHERE_END }]) : I.Set()
      }
    ]
  }

  public isDuplicateUuid(uuid: string) {
    const pages = this.allPages.all()
    const duplicateUuids = I.Set(findDuplicates(I.List(pages).filter(p => p.exists()).map(p => p.uuid())))
    return duplicateUuids.has(uuid)
  }
}

export enum PathType {
  ABS_TO_REL = 'REL_TO_REL',
  COLLECTION_TO_MODULEID = 'COLLECTION_TO_MODULEID',
  MODULE_TO_MODULEID = 'MODULE_TO_MODULEID',
}

function findDuplicates<T>(list: I.List<T>) {
  return list.filter((item, index) => index !== list.indexOf(item))
}
