import { glob } from 'glob';
import path from 'path'
import I from 'immutable'
import { Connection, Range } from 'vscode-languageserver';
import { Diagnostic, DiagnosticSeverity, FileChangeType, FileEvent } from "vscode-languageserver-protocol";
import { URI } from "vscode-uri";
import { TocTreeModule, TocTreeCollection, TocTreeElement, TocTreeElementType } from '../../common/src/toc-tree';
import { BookNode, Bundle, Fileish, PageNode, ModelError, TocNode, TocNodeType, Validator } from "./model";
import { expect } from './utils';

// Note: `[^\/]+` means "All characters except slash"
const IMAGE_RE = /\/media\/[^\/]+\.[^\.]+$/  
const PAGE_RE = /\/modules\/[^\/]+\/index\.cnxml$/
const BOOK_RE = /\/collections\/[^\/]+\.collection\.xml$/

const PATH_SEP = path.sep

function findTheNode(bundle: Bundle, absPath: string) {
    if (IMAGE_RE.test(absPath)) { return bundle.allImages.get(absPath) }
    else if (PAGE_RE.test(absPath)) { return bundle.allPages.get(absPath) }
    else if (BOOK_RE.test(absPath)) { return bundle.allBooks.get(absPath) }
    else { return null }
}

function pageToModuleId(page: PageNode) {
    // /path/to/modules/m123456/index.cnxml
    return path.basename(path.dirname(page.filePath))
}

export function nodeToUri(node: Fileish) {
    return `file:${node.filePath}`
}

export function pageAsTreeObject(page: PageNode): TocTreeModule {
    return {
        type: TocTreeElementType.module,
        moduleid: pageToModuleId(page),
        title: page.title(),
        subtitle: pageToModuleId(page)
    }
}

export function bookTocAsTreeCollection(book: BookNode): TocTreeCollection {
    const children = book.toc().map(recTocConvert)
    return {
        type: TocTreeElementType.collection,
        title: book.title(),
        slug: book.slug(),
        children
    }
  }

function recTocConvert(node: TocNode): TocTreeElement {
    if (node.type === TocNodeType.Inner) {
        const children = node.children.map(recTocConvert)
        return {
            type: TocTreeElementType.subcollection,
            title: node.title,
            children
        }
    } else {
        return {
            type: TocTreeElementType.module,
            title: node.page.title(),
            moduleid: pageToModuleId(node.page)
        }
    }
}


export class BundleLoadManager extends Validator {

    private _didLoadToc = false
    private _didLoadOrphans = false
    private _didLoadFull = false

    constructor(bundle: Bundle, private readonly conn: Connection) {
        super(bundle)
    }
    public async loadEnoughForToc() {
        if (!this._didLoadToc) {
            const errs = await this.bundle.loadEnoughForToc()
            this.sendErrors(errs)
            this._didLoadToc = true
        }
        await Promise.all(this.bundle.books().map(b => b.update()))
    }
    public async loadEnoughForOrphans() {
        if (!this._didLoadOrphans) {
            await this.loadEnoughForToc()
            // Add all the orphaned Images/Pages/Books dangling around in the filesystem without loading them
            const files = glob.sync('{modules/*/index.cnxml,media/*.*,collections/*.collection.xml}', {cwd: this.bundle.workspaceRoot, absolute: true})
            files.forEach(absPath => expect(findTheNode(this.bundle, absPath), `BUG? We found files that the bundle did not recognize: ${absPath}`))
            this._didLoadOrphans = true
        }
    }
    private async loadFull() {
        if (this._didLoadFull) return
        const errs = await this.bundle.load(true)
        this.sendErrors(errs)
        this._didLoadFull = true
    }

    async processFilesystemChange(evt: FileEvent): Promise<number> {
        const {bundle} = this
        const {type, uri} = evt
        const absPath = URI.parse(uri).fsPath
        
        // Could be adding an Image/Page/Book, or removing/adding a directory, or adding some other file
        
        if (evt.type === FileChangeType.Created) {
            // Check if we are adding an Image/Page/Book
            const node = findTheNode(bundle, absPath)
            if (node) {
                await node.update()
                return 1
            } else {
                // No, we are adding something unknown. Ignore
                console.log('New file did not match anything we understand. Ignoring', absPath)
                return 0
            }
        } else {
            // Check if we are updating/deleting a Image/Page/Book/Bundle
            const item = bundle.filePath === absPath ? bundle : (
                bundle.allBooks.getIfHas(absPath) ||
                bundle.allPages.getIfHas(absPath) ||
                bundle.allImages.getIfHas(absPath))
    
            if (item) { await this.processItem(type, item); return 1 }
    
            // Now, we might be deleting a whole directory.
            // Remove anything inside that directory
            const filePathDir = `${absPath}${PATH_SEP}`
            return bundle.allBooks.removeByPathPrefix(filePathDir) +
                bundle.allPages.removeByPathPrefix(filePathDir) +
                bundle.allImages.removeByPathPrefix(filePathDir)
        }
    }

    private async processItem(type: FileChangeType, item: Fileish) {
        switch(type) {
            case FileChangeType.Deleted:
            case FileChangeType.Changed:
                const err = await item.update()
                this.sendErrors(err ? I.Set<ModelError>().add(err) : I.Set())
                return
            case FileChangeType.Created:
            default:
                throw new Error('BUG: We do not know how to handle created items yet')
        }
    }

    private sendErrors(errs: I.Set<ModelError>) {
        if (errs.isEmpty()) { return }
        const grouped = errs.groupBy(err => err.node)
        grouped.forEach((errs, node) => {
            const uri = nodeToUri(node)
            const diagnostics = errs.toSet().map(err => {
                const start = err.startPos ?? { line: 0, character: 0 }
                const end = err.endPos ?? start
                const range = Range.create(start, end)
                return Diagnostic.create(range, err.message, DiagnosticSeverity.Error)
            }).toArray()
            this.conn.sendDiagnostics({
              uri,
              diagnostics  
            })
        })
    }

    async performInitialValidation() {
        await this.bundle.load(true)
        await Promise.all(this.bundle.allNodes().map(n => this.sendErrors(n.getAllValidationErrors())).toArray())
    }

    async loadEnoughToSendDiagnostics(docUri: string) {
        // load the books to see if this URI is a page in a book
        await this.bundle.load(false)
        await Promise.all(this.bundle.books().map(b => b.load(false)))
        const page = this.bundle.allPages.getIfHas(URI.parse(docUri).fsPath)
        if (page) {
            this.sendErrors(await page.getCheapValidationErrors())
        }
    }
}
