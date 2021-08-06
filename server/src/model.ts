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

const select = xpath.useNamespaces({ cnxml: NS_CNXML, col: NS_COLLECTION, md: NS_METADATA, bk: NS_CONTAINER })
const selectOne = <T extends Node>(sel: string, doc: Node): T => {
    const ret = select(sel, doc) as Node[]
    expect(ret.length == 1 || null, `ERROR: Expected one but found ${ret.length} results that match '${sel}'`)
    return ret[0] as T
}

type Opt<T> = T | null

// This matches the signature of vscode-languageserver-textdocument.Position without needing to import it
export interface Position {
    line: number // 0-based
    character: number // 0-based
}

export abstract class Fileish {
    private _isLoaded = false
    private _exists = false
    private _parseError: Opt<Error> = null
    protected parseXML: Opt<(doc: Document) => void> = null // Subclasses define this
    protected childrenToLoad: Opt<() => I.Set<Fileish>> = null // Subclasses define this

    constructor(private _bundle: Opt<Bundle>, public readonly filePath: string) { }

    protected setBundle(bundle: Bundle) { this._bundle = bundle /* avoid catch-22 */ }
    protected bundle() { return expect(this._bundle, 'BUG: This object was not instantiated with a Bundle. The only case that should occur is when this is a Bundle object') }
    protected ensureLoaded<T>(field: Opt<T>) {
        return expect(field, `${LOAD_ERROR} [${this.filePath}]`)
    }
    public exists() { return this._exists }
    public async update() {
        // console.info(this.filePath, 'update() started')
        if (this.parseXML) {
            // console.info(this.filePath, 'parsing XML')
            const doc = await this.readXML()
            try {
                this.parseXML(doc)
                this._parseError = null
                this._isLoaded = true
            } catch (err) {
                console.error('Errored but continuing', err)
                this._parseError = err
            }
            // console.info(this.filePath, 'parsing XML (done)')
        } else {
            this._isLoaded = true
        }
        this._exists = (await fs.promises.stat(this.filePath)).isFile()
        // console.info(this.filePath, 'update done')
        return this._isLoaded
    }
    public async load(recurse: boolean) {
        // console.info(this.filePath, 'load started')
        await this.update()
        if (recurse && this._isLoaded && this.childrenToLoad) {
            const children = this.childrenToLoad()
            // console.info(this.filePath, 'loading children start', children.size)
            await Promise.all(children.map(c => c.load(true)))
            // console.info(this.filePath, 'loading children done', children.size)
        }
        // console.info(this.filePath, 'load done')
        return this._isLoaded
    }
    private async readFile() {
        return fs.promises.readFile(this.filePath, 'utf-8')
    }
    private async readXML() {
        return new DOMParser().parseFromString(await this.readFile())
    }
}

export class ImageNode extends Fileish {
}

type ImageLink = {
    image: ImageNode
    startPos: Position
    endPos: Position
}

type PageLink = {
    page: PageNode
    targetElementId: Opt<string>
}

export class PageNode extends Fileish {
    private _title: Opt<string> = null
    private _elementIds: Opt<I.Set<string>> = null
    private _imageLinks: Opt<I.Set<ImageLink>> = null
    private _pageLinks: Opt<I.Set<PageLink>> = null
    public title() {
        // A quick way to get the title for the ToC
        if (this._title === null) {
            const data = fs.readFileSync(this.filePath, 'utf-8')
            this._title = this.guessTitle(data)
        }
        return this._title ?? 'UntitledFile'
    }
    private guessTitle(data: string): string | null {
        const openTag = '<title>'
        const titleTagStart = data.indexOf(openTag)
        const titleTagEnd = data.indexOf('</title>')
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
        return data.substring(actualTitleStart, titleTagEnd).trim()
    }
    public imageLinks() {
        return this.ensureLoaded(this._imageLinks)
    }
    public pageLinks() {
        return this.ensureLoaded(this._pageLinks)
    }
    public hasElementId(id: string) {
        return this.ensureLoaded(this._elementIds).has(id)
    }

    protected childrenToLoad = () => this.imageLinks().map(l => l.image)
    protected parseXML = (doc: Document) => {
        const ids = select('//cnxml:*/@id', doc) as Attr[]
        this._elementIds = I.Set(ids.map(attr => expect(attr.nodeValue, 'BUG: Attribute does not have a value')))

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
            const toDocument = linkNode.getAttribute('document')
            const toTargetId = linkNode.getAttribute('target-id')
            return {
                page: toDocument ? super.bundle().allPages.get(joiner(PathType.MODULE_TO_MODULEID, this.filePath, toDocument)) : this,
                targetElementId: toTargetId ? toTargetId : null // could be empty string
            }
        }))

        const titleNode = select('//cnxml:title', doc) as Element[]
        if (titleNode.length > 0) {
            this._title = titleNode[0].textContent ?? ''
        } else {
            this._title = 'Unnamed Module'
        }
    }
}

export enum TocNodeType {
    Inner,
    Leaf
}
export type TocNode = TocInner | TocLeaf
type TocInner = { readonly type: TocNodeType.Inner, readonly title: string, readonly children: TocNode[] }
type TocLeaf = { readonly type: TocNodeType.Leaf, readonly page: PageNode, startPos: Position, endPos: Position }

export class BookNode extends Fileish {
    private _title: Opt<string> = null
    private _slug: Opt<string> = null
    private _toc: Opt<TocNode[]> = null

    protected childrenToLoad = () => I.Set(this.pages())
    protected parseXML = (doc: Document) => {
        this._title = selectOne('/col:collection/col:metadata/md:title/text()', doc).nodeValue
        this._slug = selectOne('/col:collection/col:metadata/md:slug/text()', doc).nodeValue
        const root: Element = selectOne('/col:collection/col:content', doc)
        this._toc = this.buildChildren(root)
    }

    private buildChildren(root: Element): TocNode[] {
        const ret = (select('./col:*', root) as Element[]).map(childNode => {
            switch (childNode.localName) {
                case 'subcollection':
                    return {
                        type: TocNodeType.Inner,
                        title: expect(selectOne('md:title/text()', childNode).nodeValue, 'ERROR: Malformed or missing md:title element in Subcollection'),
                        children: this.buildChildren(selectOne('./col:content', childNode))
                    } as TocInner
                case 'module':
                    const pageId = expect(selectOne('@document', childNode).nodeValue, 'BUG: missing @document on col:module')
                    const page = super.bundle().allPages.get(joiner(PathType.COLLECTION_TO_MODULEID, this.filePath, pageId))
                    const [startPos, endPos] = calculateElementPositions(childNode)
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
        return this.ensureLoaded(this._title)
    }
    public slug() {
        return this.ensureLoaded(this._slug)
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
}


export class Bundle extends Fileish {
    public readonly allImages = new Factory((absPath: string) => new ImageNode(this, absPath))
    public readonly allPages = new Factory((absPath: string) => new PageNode(this, absPath))
    public readonly allBooks = new Factory((absPath: string) => new BookNode(this, absPath))
    private _books: Opt<I.Set<BookNode>> = null

    constructor(public readonly workspaceRoot: string) {
        super(null, path.join(workspaceRoot, 'META-INF/books.xml'))
        super.setBundle(this)
    }
    protected childrenToLoad = () => this.ensureLoaded(this._books)
    protected parseXML = (doc: Document) => {
        const bookNodes = select('//bk:book', doc) as Element[]
        this._books = I.Set(bookNodes.map(b => {
            const href = expect(b.getAttribute('href'), 'ERROR: Missing @href attribute on book element')
            return this.allBooks.get(joiner(PathType.REL_TO_REL, this.filePath, href))
        }))
    }

    public books() {
        return this.ensureLoaded(this._books)
    }

    public async loadEnoughForToc() {
        await this.load(false)
        await Promise.all(this.books().map(b => b.load(false)))
    }

    private gc() {
        // Remove any objects that don't exist and are not pointed to by a book
        // This may need to run every time an object is deleted (or exists is set to false)
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


export class Validator {
    constructor(protected readonly bundle: Bundle) { }

    public allPages() {
        return this.bundle.allPages.all()
    }
    public missingImages() {
        return this.bundle.books().flatMap(this._missingImages)
    }
    public missingPageTargets() {
        return this.bundle.books().flatMap(this._missingPageTargets)
    }
    public duplicatePagesInToC() {
        return this.bundle.books().flatMap(this._duplicatePagesInToc)
    }
    public orhpanedPages() {
        const books = this.bundle.books()
        return this.bundle.allPages.all().subtract(books.flatMap(b => b.pages()))
    }

    private _missingImages(book: BookNode) {
        const pages = book.pages()
        const links = pages.flatMap(page => page.imageLinks().map(link => ({ page, link })))
        return links.filter(i => !i.link.image.exists())
    }
    private _missingPageTargets(book: BookNode) {
        const pages = book.pages()
        const links = pages.flatMap(page => page.pageLinks().map(link => ({ page, link })))
        return links.filter(i => !i.link.page.exists() || (i.link.targetElementId && !i.page.hasElementId(i.link.targetElementId)))
    }

    private _duplicatePagesInToc(book: BookNode) {
        return book.pages().reduce((acc, page) => {
            const { visited, duplicates } = acc
            if (visited.has(page)) {
                return { visited, duplicates: duplicates.add(page) }
            } else {
                return { visited: acc.visited.add(page), duplicates }
            }
        }, { visited: I.Set<PageNode>(), duplicates: I.Set<PageNode>() }).duplicates
    }
}
