import fs from 'fs'
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

const NOWHERE_START: Position = {line: 0, character: 0}
const NOWHERE_END: Position = {line: 0, character: Number.MAX_VALUE}

const select = xpath.useNamespaces({ cnxml: NS_CNXML, col: NS_COLLECTION, md: NS_METADATA, bk: NS_CONTAINER })
const selectOne = <T extends Node>(sel: string, doc: Node): T => {
    const ret = select(sel, doc) as Node[]
    expect(ret.length == 1 || null, `ERROR: Expected one but found ${ret.length} results that match '${sel}'`)
    return ret[0] as T
}

export type Opt<T> = T | null

// This matches the signature of vscode-languageserver-textdocument.Position without needing to import it
export interface Position {
    line: number // 0-based
    character: number // 0-based
}

export class ModelError extends Error {
    constructor(public readonly node: Fileish, message: string, public readonly startPos: Opt<Position>, public readonly endPos: Opt<Position>) {
        super(message)
        this.name = this.constructor.name
    }
}
export class ParseError extends ModelError {
    constructor(node: Fileish, message: string, startPos: Opt<Position>, endPos: Opt<Position>) {
        super(node, message, startPos, endPos)
    }
}
export class WrappedParseError<T extends Error> extends ParseError {
    constructor(node: Fileish, originalError: T) {
        super(node, originalError.message, null, null)
        console.error(node.filePath, originalError)
    }
}

export abstract class Fileish {
    private _isLoaded = false
    private _exists = false
    protected parseXML: Opt<(doc: Document) => (ParseError | void)> = null // Subclasses define this
    protected childrenToLoad: Opt<() => I.Set<Fileish>> = null // Subclasses define this

    constructor(private _bundle: Opt<Bundle>, public readonly filePath: string) { }

    public abstract getValidationErrors(): I.Set<ModelError>
    protected setBundle(bundle: Bundle) { this._bundle = bundle /* avoid catch-22 */ }
    protected bundle() { return expect(this._bundle, 'BUG: This object was not instantiated with a Bundle. The only case that should occur is when this is a Bundle object') }
    protected ensureLoaded<T>(field: Opt<T>) {
        return expect(field, `${LOAD_ERROR} [${this.filePath}]`)
    }
    public exists() { return this._exists }
    public async update(): Promise<Opt<ParseError>> {
        // console.info(this.filePath, 'update() started')
        if (this.parseXML) {
            // console.info(this.filePath, 'parsing XML')

            // Development branch throws errors instead of turning them into messages
            if (process.env['NODE_ENV'] !== 'production') {
                const {doc} = await this.readXML()
                this.parseXML(doc)
                this._isLoaded = true
            } else {
                try {
                    const {err, doc} = await this.readXML()
                    if (err) return err
                    const err2 = this.parseXML(doc)
                    if (err2) return err2
                    this._isLoaded = true
                } catch (e) {
                    console.error('Errored but continuing', e)
                    return new WrappedParseError(this, e)
                }
            }
            // console.info(this.filePath, 'parsing XML (done)')
        } else {
            this._isLoaded = true
        }
        this._exists = (await fs.promises.stat(this.filePath)).isFile()
        // console.info(this.filePath, 'update done')
        return null
    }
    // Update this Node, load all children (if recurse is true), and collect all Parse errors
    public async load(recurse: boolean): Promise<I.Set<ParseError>> {
        // console.info(this.filePath, 'load started')
        const err = await this.update()
        if (recurse && this._isLoaded && this.childrenToLoad) {
            const children = this.childrenToLoad()
            // console.info(this.filePath, 'loading children start', children.size)
            let errs = I.Set(await Promise.all(children.map(c => c.load(true)))).flatMap(c => c)
            if (err) { errs = errs.add(err) }
            // console.info(this.filePath, 'loading children done', children.size)
            return errs
        }
        // console.info(this.filePath, 'load done')
        return err ? I.Set<ParseError>().add(err) : I.Set<ParseError>()
    }
    private async readFile() {
        return fs.promises.readFile(this.filePath, 'utf-8')
    }
    private async readXML() {
        let parseError: Opt<ParseError> = null
        const locator = {lineNumber: 0, columnNumber: 0}
        const cb = (msg: string) => {
            const pos = {
                line: locator.lineNumber - 1,
                character: locator.columnNumber - 1
            }
            parseError = new ParseError(this, msg, pos, pos)
        }
        const p = new DOMParser({
            locator,
            errorHandler: {
                warning: console.warn,
                error: cb,
                fatalError: cb
            }
        })
        const doc = p.parseFromString(await this.readFile())
        return {err: parseError, doc} as {err: Opt<ParseError>, doc: Document}
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
    page: PageNode
    targetElementId: Opt<string>
}

function textWithSource(el: Element, attr?: string): WithSource<string> {
    const [startPos, endPos] = calculateElementPositions(el)
    const v = attr ? el.getAttribute(attr) : el.textContent
    return {
        v: expect(v, `BUG: Element/Attribute does not have a value. ${JSON.stringify(startPos)}`),
        startPos,
        endPos
    }
}

export class ImageNode extends Fileish {
    public getValidationErrors(): never { throw new Error('BUG: Unimplemented yet') }
}

function convertToPos(str: string, cursor: number): Position {
    const lines = str.substring(cursor).split('\n')
    return {line: lines.length, character: lines[lines.length-1].length}
}
function toValidationErrors(node: Fileish, message: string, sources: I.Set<Source>) {
    return sources.map(s => new ModelError(node, message, s.startPos, s.endPos))
}
export class PageNode extends Fileish {
    private _uuid: Opt<WithSource<string>> = null
    private _title: Opt<WithSource<string>> = null
    private _elementIds: Opt<I.Set<WithSource<string>>> = null
    private _imageLinks: Opt<I.Set<ImageLink>> = null
    private _pageLinks: Opt<I.Set<PageLink>> = null
    public uuid() { return this.ensureLoaded(this._uuid).v }
    public title() {
        // A quick way to get the title for the ToC
        if (this._title === null) {
            const data = fs.readFileSync(this.filePath, 'utf-8')
            this._title = this.guessTitle(data)
        }
        return this._title?.v ?? 'UntitledFile'
    }
    private guessTitle(data: string): WithSource<string> | null {
        const openTag = '<title>'
        const closeTag = '</title>'
        const titleTagStart = data.indexOf(openTag)
        const titleTagEnd = data.indexOf(closeTag)
        if (titleTagStart === -1 || titleTagEnd === -1) {
            return null
        }
        const actualTitleStart = titleTagStart + openTag.length
        if (titleTagEnd - actualTitleStart > 280) {
            // If the title is so long you can't tweet it,
            // then something probably went wrong.
            /* istanbul ignore next */
            return null
        }
        return {
            v: data.substring(actualTitleStart, titleTagEnd).trim(),
            startPos: convertToPos(data, actualTitleStart),
            endPos: convertToPos(data, titleTagEnd),
        }
    }
    public imageLinks() {
        return this.ensureLoaded(this._imageLinks)
    }
    public pageLinks() {
        return this.ensureLoaded(this._pageLinks)
    }
    public hasElementId(id: string) {
        return !!this.ensureLoaded(this._elementIds).toSeq().find(n => n.v === id)
    }

    protected childrenToLoad = () => this.imageLinks().map(l => l.image)
    protected parseXML = (doc: Document) => {
        this._uuid = textWithSource(selectOne('//md:uuid', doc))

        this._elementIds = I.Set((select('//cnxml:*[@id]', doc) as Element[]).map(el => textWithSource(el, 'id')))

        const imageNodes = select('//cnxml:image/@src', doc) as Attr[]
        this._imageLinks = I.Set(imageNodes.map(attr => {
            const src = expect(attr.nodeValue, 'BUG: Attribute does not have a value')
            const image = super.bundle().allImages.get(joiner(PathType.REL_TO_REL, this.filePath, src))
            // Get the line/col position of the <image> tag
            const imageNode = expect(attr.ownerElement, 'BUG: attributes always have a parent element')
            const [startPos, endPos] = calculateElementPositions(imageNode)
            return { image, startPos, endPos }
        }))

        const linkNodes = select('//cnxml:link', doc) as Element[]
        this._pageLinks = I.Set(linkNodes.map(linkNode => {
            const [startPos, endPos] = calculateElementPositions(linkNode)
            const toDocument = linkNode.getAttribute('document')
            const toTargetId = linkNode.getAttribute('target-id')
            return {
                page: toDocument ? super.bundle().allPages.get(joiner(PathType.MODULE_TO_MODULEID, this.filePath, toDocument)) : this,
                targetElementId: toTargetId ? toTargetId : null, // could be empty string
                startPos, endPos
            }
        }))

        const titleNode = select('//cnxml:title', doc) as Element[]
        if (titleNode.length > 0) {
            this._title = textWithSource(titleNode[0])
        } else {
            this._title = {
                v: 'Unnamed Module',
                startPos: NOWHERE_START,
                endPos: NOWHERE_END,
            }
        }
    }

    public getValidationErrors() {
        return this.findBrokenImageLinks()
        .union(this.findBrokenPageLinks())
        .union(this.findDuplicateUuid())
    }
    private findBrokenImageLinks(): I.Set<ModelError> {
        return toValidationErrors(this, 'Image not found', this.imageLinks().filter(img => !img.image.exists()))
    }
    private findBrokenPageLinks(): I.Set<ModelError> {
        return toValidationErrors(this, 'Link target not found', this.pageLinks()
        .filter(l => !l.page.exists() || (l.targetElementId && !l.page.hasElementId(l.targetElementId))))
    }
    private findDuplicateUuid(): I.Set<ModelError> {
        const uuid = this.ensureLoaded(this._uuid)
        const dup = this.bundle().allDuplicatePageUuids().has(uuid.v) ? [uuid]: []
        return toValidationErrors(this, 'Duplicate UUID detected', I.Set(dup))
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
    private _title: Opt<WithSource<string>> = null
    private _slug: Opt<WithSource<string>> = null
    private _toc: Opt<TocNode[]> = null

    protected childrenToLoad = () => I.Set(this.pages())
    protected parseXML = (doc: Document) => {
        this._title = textWithSource(selectOne('/col:collection/col:metadata/md:title', doc))
        this._slug = textWithSource(selectOne('/col:collection/col:metadata/md:slug', doc))
        const root: Element = selectOne('/col:collection/col:content', doc)
        this._toc = this.buildChildren(root)
    }

    private buildChildren(root: Element): TocNode[] {
        const ret = (select('./col:*', root) as Element[]).map(childNode => {
            const [startPos, endPos] = calculateElementPositions(childNode)
            switch (childNode.localName) {
                case 'subcollection':
                    return {
                        type: TocNodeType.Inner,
                        title: expect(selectOne('md:title/text()', childNode).nodeValue, 'ERROR: Malformed or missing md:title element in Subcollection'),
                        children: this.buildChildren(selectOne('./col:content', childNode)),
                        startPos,
                        endPos,
                    } as TocInner
                case 'module':
                    const pageId = expect(selectOne('@document', childNode).nodeValue, 'BUG: missing @document on col:module')
                    const page = super.bundle().allPages.get(joiner(PathType.COLLECTION_TO_MODULEID, this.filePath, pageId))
                    return {
                        type: TocNodeType.Leaf,
                        page,
                        startPos,
                        endPos,
                    } as TocLeaf
                default:
                    throw new Error('ERROR: Unknown element in the ToC')
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
            if (n.type === TocNodeType.Leaf) { acc.push(n) }
            else { this.collectPages(n.children, acc) }
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

    public getValidationErrors() {
        return this.missingPages().union(this.duplicateChapterTitles())
    }
    private missingPages(): I.Set<ModelError> {
        return toValidationErrors(this, 'Missing Page', I.Set(this.tocLeaves()).filter(p => !p.page.exists()))
    }
    private duplicateChapterTitles(): I.Set<ModelError> {
        const nonPages = I.List<TocInner>().withMutations(acc => this.collectNonPages(this.toc(), acc))
        return toValidationErrors(this, 'Duplicate Chapter Title', I.Set(findDuplicates(nonPages)))
    }
}


export class Bundle extends Fileish {
    public readonly allImages = new Factory((absPath: string) => new ImageNode(this, absPath))
    public readonly allPages = new Factory((absPath: string) => new PageNode(this, absPath))
    public readonly allBooks = new Factory((absPath: string) => new BookNode(this, absPath))
    private _books: Opt<I.Set<WithSource<BookNode>>> = null

    constructor(public readonly workspaceRoot: string) {
        super(null, path.join(workspaceRoot, 'META-INF/books.xml'))
        super.setBundle(this)
    }
    protected childrenToLoad = () => this.books()
    protected parseXML = (doc: Document) => {
        const bookNodes = select('//bk:book', doc) as Element[]
        this._books = I.Set(bookNodes.map(b => {
            const [startPos, endPos] = calculateElementPositions(b)
            const href = expect(b.getAttribute('href'), 'ERROR: Missing @href attribute on book element')
            const book = this.allBooks.get(joiner(PathType.REL_TO_REL, this.filePath, href))
            return {
                v: book,
                startPos,
                endPos
            }
        }))
    }

    public books() {
        return this.__books().map(b => b.v)
    }
    private __books() {
        return this.ensureLoaded(this._books)
    }

    public async loadEnoughForToc() {
        const errs1 = await this.load(false)
        const errs2 = I.Set(await Promise.all(this.books().map(b => b.load(false)))).flatMap(c=>c)
        return errs1.union(errs2)
    }

    private gc() {
        // Remove any objects that don't exist and are not pointed to by a book
        // This may need to run every time an object is deleted (or exists is set to false)
    }

    public allDuplicatePageUuids() {
        const uuids = I.List(this.books().flatMap(b => b.pages())).map(p => p.uuid())
        return I.Set(findDuplicates(uuids))
    }

    public getValidationErrors() {
        // Check that there is at least one book and that every book exists
        return this.missingBooks().union(this.atLeastOneBook())
    }

    private missingBooks(): I.Set<ModelError> {
        return toValidationErrors(this, 'Missing Book', I.Set(this.__books()).filter(b => !b.v.exists()))
    }
    private atLeastOneBook(): I.Set<ModelError> {
        if (this.books().size === 0) {
            return I.Set([new ModelError(this, 'At least one book must be in the bundle', NOWHERE_START, NOWHERE_END)])
        } else { return I.Set() }
    }

}

export enum PathType {
    REL_TO_REL = 'REL_TO_REL',
    COLLECTION_TO_MODULEID = 'COLLECTION_TO_MODULEID',
    MODULE_TO_MODULEID = 'MODULE_TO_MODULEID',
    MODULE_TO_IMAGE = 'MODULE_TO_IMAGE',
    ABSOLUTE_JUST_ONE_FILE = 'ABSOLUTE',
}

export class Factory<T> {
    private _map = I.Map<string, T>()
    constructor(private readonly builder: (filePath: string) => T) { }
    getIfHas(filePath: string): Opt<T> {
        return this._map.get(filePath) ?? null
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
        expect(this._map.has(filePath) || null, `ERROR: Attempting to remove a file that was never created: '${filePath}'`)
        this._map = this._map.delete(filePath)
    }
    public removeByPathPrefix(pathPrefix: string) {
        const size = this._map.size
        this._map = this._map.filter((_, key) => !key.startsWith(pathPrefix))
        return size - this._map.size
    }
    private size() { return this._map.size }
    public all() { return I.Set(this._map.values()) }
}

function joiner(type: PathType, parent: string, child: string) {
    let p = null
    let c = null
    switch (type) {
        case PathType.MODULE_TO_IMAGE:
        case PathType.REL_TO_REL: p = path.dirname(parent); c = child; break
        case PathType.COLLECTION_TO_MODULEID: p = path.dirname(path.dirname(parent)); c = path.join('modules', child, 'index.cnxml'); break;
        case PathType.MODULE_TO_MODULEID: p = path.dirname(path.dirname(parent)); c = path.join(child, 'index.cnxml'); break
        case PathType.ABSOLUTE_JUST_ONE_FILE:
            expect(child === '' || null, 'When using ABSOLUTE, there is no second argument to this function')
            return path.resolve(parent)
        default: throw new Error(`BUG: Unsupported path type '${type}'. Consider adding it`)
    }
    return path.resolve(p, c)
}


function findDuplicates<T>(list: I.List<T>) {
    return list.filter((item, index) => index !== list.indexOf(item))
}

export class Validator {
    constructor(protected readonly bundle: Bundle) { }

    public allPages() {
        return this.bundle.allPages.all()
    }
    public orhpanedPages() {
        const books = this.bundle.books()
        return this.bundle.allPages.all().subtract(books.flatMap(b => b.pages()))
    }
}
