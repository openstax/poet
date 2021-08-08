import { glob } from 'glob';
import fs from 'fs'
import path from 'path'
import { Connection, Range } from 'vscode-languageserver';
import { Diagnostic, DiagnosticSeverity, FileChangeType, FileEvent, WorkspaceFolder } from "vscode-languageserver-protocol";
import { URI } from "vscode-uri";
import { TocTreeModule, TocTreeCollection, TocTreeElement, TocTreeElementType } from '../../common/src/toc-tree';
import { BookNode, Bundle, Fileish, PageNode, Opt, TocNode, TocNodeType, ValidationResponse } from "./model";
import { expect, profileAsync } from './utils';
import { TextDocument } from 'vscode-languageserver-textdocument';

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
    return path.basename(path.dirname(page.absPath))
}

export function pageAsTreeObject(page: PageNode): TocTreeModule {
    return {
        type: TocTreeElementType.module,
        moduleid: pageToModuleId(page),
        title: page.title(() => readSync(page)),
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
            title: node.page.title(() => readSync(node.page)),
            moduleid: pageToModuleId(node.page)
        }
    }
}

// https://stackoverflow.com/a/35008327
const checkFileExists = async (s: string): Promise<boolean> => new Promise(r=>fs.access(s, fs.constants.F_OK, e => r(!e)))

async function readOrNull(uri: string): Promise<Opt<string>> {
    const {fsPath} = URI.parse(uri)
    if (await checkFileExists(fsPath)) {
        return fs.promises.readFile(fsPath, 'utf-8')
    }
    return null
}
function readSync(n: Fileish) {
    const {fsPath} = URI.parse(n.absPath)
    return fs.readFileSync(fsPath, 'utf-8')
}

export class BundleLoadManager {

    private _didLoadToc = false
    private _didLoadOrphans = false
    private _didLoadFull = false

    constructor(public bundle: Bundle, private readonly conn: Connection) {}

    public allPages() {
        return this.bundle.allPages.all()
    }
    public orhpanedPages() {
        const books = this.bundle.books()
        return this.bundle.allPages.all().subtract(books.flatMap(b => b.pages()))
    }

    public async loadEnoughForToc() {
        // The only reason this is not implemented as a Job is because we need to send a timely response to the client
        // and there is no code for being notified when a Job completes
        await this.readAndLoad(this.bundle)
        
        await Promise.all(this.bundle.books().map(async b => {
            await this.readAndLoad(b)
        }))
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

    async processFilesystemChange(evt: FileEvent): Promise<number> {
        const {bundle} = this
        const {type, uri} = evt
        const absPath = URI.parse(uri).fsPath
        
        // Could be adding an Image/Page/Book, or removing/adding a directory, or adding some other file
        
        if (evt.type === FileChangeType.Created) {
            // Check if we are adding an Image/Page/Book
            const node = findTheNode(bundle, absPath)
            if (node) {
                await this.readAndLoad(node)
                return 1
            } else {
                // No, we are adding something unknown. Ignore
                console.log('New file did not match anything we understand. Ignoring', absPath)
                return 0
            }
        } else {
            // Check if we are updating/deleting a Image/Page/Book/Bundle
            const item = bundle.absPath === absPath ? bundle : (
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
                await this.readAndUpdate(item)
                this.sendErrors(item.getValidationErrors())
                return
            case FileChangeType.Created:
            default:
                throw new Error('BUG: We do not know how to handle created items yet')
        }
    }

    private async readAndLoad(node: Fileish) {
        if (node.isLoaded()) { return }
        const fileContent = await readOrNull(node.absPath)
        node.load(fileContent)
    }
    private async readAndUpdate(node: Fileish) {
        const fileContent = await readOrNull(node.absPath)
        node.update(fileContent)
    }

    private sendErrors(resp: ValidationResponse) {
        const { errors, nodesToLoad } = resp
        if (nodesToLoad.isEmpty()) {
            if (errors.isEmpty()) { return }
            const grouped = errors.groupBy(err => err.node)
            grouped.forEach((errs, node) => {
                const uri = node.absPath
                const diagnostics = errs.toSet().map(err => {
                    const start = err.startPos ?? { line: 0, character: 0 }
                    const end = err.endPos || start
                    const range = Range.create(start, end)
                    return Diagnostic.create(range, err.message, DiagnosticSeverity.Error)
                }).toArray()
                this.conn.sendDiagnostics({
                  uri,
                  diagnostics  
                })
            })
        } else {
            // push this task back onto the job stack and then add loading jobs for each node that needs to load
            console.log('Dependencies were not met yet. Enqueuing dependencies and then re-enqueueing this job', nodesToLoad.size)
            jobRunner.reEnqueueCurrentJob()
            nodesToLoad.filter(n => !n.isLoaded()).forEach(n => jobRunner.enqueue({type: 'LOAD_DEPENDENCY', context: n, fn: async () => this.readAndLoad(n)}))
        }
    }

    async performInitialValidation() {
        const jobs = [
            {type: 'INITIAL_LOAD_BUNDLE', context: this.bundle, fn: async () => this._didLoadFull || await this.readAndLoad(this.bundle) },
            {type: 'INITIAL_LOAD_ALL_BOOKS', context: this.bundle, fn: async () => this._didLoadFull || await Promise.all(this.bundle.allBooks.all().map(async f => this.readAndLoad(f)))},
            {type: 'INITIAL_LOAD_ALL_PAGES', context: this.bundle, fn: async () => this._didLoadFull || await Promise.all(this.bundle.allPages.all().map(async f => this.readAndLoad(f)))},
            {type: 'INITIAL_LOAD_ALL_IMAGES', context: this.bundle, fn: async () => this._didLoadFull || await Promise.all(this.bundle.allImages.all().map(async f => this.readAndLoad(f)))},
            {type: 'INITIAL_LOAD_REPORT_VALIDATION', context: this.bundle, fn: async () => this._didLoadFull || await Promise.all(this.bundle.allNodes().map(f => this.sendErrors(f.getValidationErrors())))},
        ]
        jobs.reverse().forEach(j => jobRunner.enqueue(j))
    }

    async loadEnoughToSendDiagnostics(context: {workspace: WorkspaceFolder, doc: TextDocument}) {
        // load the books to see if this URI is a page in a book
        const jobs = [
            {type: 'FILEOPENED_LOAD_BUNDLE_DEP', context, fn: async () => await this.readAndLoad(this.bundle) },
            {type: 'FILEOPENED_LOAD_BOOKS_DEP', context, fn: async () => await Promise.all(this.bundle.books().map(async f => await this.readAndLoad(f)))},
            {type: 'FILEOPENED_SEND_DIAGNOSTICS', context, fn: async () => {
                const page = this.bundle.allPages.getIfHas(context.doc.uri)
                if (page) {
                    this.sendErrors(page.getValidationErrors())
                }
            }}
        ]
        jobs.reverse().forEach(j => jobRunner.enqueue(j))
    }
}

type URIPair = { workspace: WorkspaceFolder, doc: TextDocument }
type Job = {
    type: string
    context: Fileish | URIPair
    fn: () => Promise<any>
}

class JobRunner {
    private _current: Opt<Job> = null
    private stack: Job[] = []
    private timeout: Opt<NodeJS.Immediate> = null

    public enqueue(job: Job) {
        this.stack.push(job)
        this.tick()
    }
    public reEnqueueCurrentJob() {
        this.enqueue(expect(this._current, 'BUG: Tried to reenqueue the currently running task but no task is currently executing.'))
    }
    private tick() {
        if (this.timeout !== null) return // job is running
        this.timeout = setImmediate(async () => {
            this._current = this.stack.pop() ?? null
            if (this._current) {
                const [_, ms] = await profileAsync(async () => {
                    const c = expect(this._current, 'BUG: nothing should have changed in this time')
                    console.debug('[JOB_RUNNER] Starting job', c.type, this.toString(c.context))
                    await c.fn()
                })
                console.debug('[JOB_RUNNER] Finished job', this._current.type, this.toString(this._current.context), 'took', ms, 'ms')
                if (this.stack.length === 0) {
                    console.debug('[JOB_RUNNER] No more pending jobs. Taking a nap.')
                } else {
                    console.debug('[JOB_RUNNER] Remaining jobs', this.stack.length)
                }
            }
            this._current = null
            this.timeout = null
            if (this.stack.length > 0) this.tick()
        })
    }
    toString(nodeOrString: Fileish | URIPair) {
        if (nodeOrString instanceof Fileish) { return nodeOrString.filePath() }
        else return path.relative(nodeOrString.workspace.uri, nodeOrString.doc.uri)
    }    
}

export const jobRunner = new JobRunner()