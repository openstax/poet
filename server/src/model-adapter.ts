import { glob } from 'glob'
import fs from 'fs'
import path from 'path'
import I from 'immutable'
import { Connection, Range } from 'vscode-languageserver'
import { Diagnostic, DiagnosticSeverity, FileChangeType, FileEvent } from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
import { TocTreeModule, TocTreeCollection, TocTreeElement, TocTreeElementType } from '../../common/src/toc-tree'
import { BookNode, Bundle, Fileish, PageNode, Opt, TocNode, TocNodeType } from './model'
import { expect, profileAsync } from './utils'

// Note: `[^/]+` means "All characters except slash"
const IMAGE_RE = /\/media\/[^/]+\.[^.]+$/
const PAGE_RE = /\/modules\/[^/]+\/index\.cnxml$/
const BOOK_RE = /\/collections\/[^/]+\.collection\.xml$/

const PATH_SEP = path.sep

function findOrCreateNode(bundle: Bundle, absPath: string) {
  if (bundle.absPath === absPath) {
    return bundle
  } else if (IMAGE_RE.test(absPath)) {
    return bundle.allImages.get(absPath)
  } else if (PAGE_RE.test(absPath)) {
    return bundle.allPages.get(absPath)
  } else if (BOOK_RE.test(absPath)) {
    return bundle.allBooks.get(absPath)
  }
}

function findNode(bundle: Bundle, absPath: string) {
  return bundle.absPath === absPath
    ? bundle
    : (
        bundle.allBooks.getIfHas(absPath) ??
        bundle.allPages.getIfHas(absPath) ??
        bundle.allImages.getIfHas(absPath))
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
const checkFileExists = async (s: string): Promise<boolean> => await new Promise(resolve => fs.access(s, fs.constants.F_OK, e => resolve(e === null)))

async function readOrNull(uri: string): Promise<Opt<string>> {
  const { fsPath } = URI.parse(uri)
  if (await checkFileExists(fsPath)) {
    return await fs.promises.readFile(fsPath, 'utf-8')
  }
}
function readSync(n: Fileish) {
  const { fsPath } = URI.parse(n.absPath)
  return fs.readFileSync(fsPath, 'utf-8')
}

function toStringFileChangeType(t: FileChangeType) {
  switch (t) {
    case FileChangeType.Changed: return 'CHANGED'
    case FileChangeType.Created: return 'CREATED'
    case FileChangeType.Deleted: return 'DELETED'
  }
}
export class BundleLoadManager {
  public static debug: (...args: any[]) => void = console.debug

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
    this.sendFileDiagnostics(this.bundle)

    await Promise.all(this.bundle.books().map(async b => {
      await this.readAndLoad(b)
      this.sendFileDiagnostics(b)
    }))
  }

  public async loadEnoughForOrphans() {
    await this.loadEnoughForToc()
    // Add all the orphaned Images/Pages/Books dangling around in the filesystem without loading them
    const files = glob.sync('{modules/*/index.cnxml,media/*.*,collections/*.collection.xml}', { cwd: this.bundle.workspaceRoot, absolute: true })
    files.forEach(absPath => expect(findOrCreateNode(this.bundle, absPath), `BUG? We found files that the bundle did not recognize: ${absPath}`))
  }

  async processFilesystemChange(evt: FileEvent): Promise<I.Set<Fileish>> {
    const { bundle } = this
    const { type, uri } = evt

    // Could be adding an Image/Page/Book, or removing/adding a directory, or adding some other file
    BundleLoadManager.debug(`[FILESYSTEM_EVENT] Start ${toStringFileChangeType(type)} ${uri}`)

    if (type === FileChangeType.Created) {
      // Check if we are adding an Image/Page/Book
      const node = findOrCreateNode(bundle, uri)
      if (node !== undefined) {
        BundleLoadManager.debug('[FILESYSTEM_EVENT] Adding item')
        await this.readAndLoad(node)
        return I.Set([node])
      } else {
        // No, we are adding something unknown. Ignore
        BundleLoadManager.debug('[FILESYSTEM_EVENT] New file did not match anything we understand. Ignoring', uri)
        return I.Set()
      }
    } else if (type === FileChangeType.Changed) {
      const item = findNode(bundle, uri)
      if (item !== undefined) {
        BundleLoadManager.debug('[FILESYSTEM_EVENT] Found item')
        await this.readAndUpdate(item)
        this.sendFileDiagnostics(item)
        return I.Set([item])
      } else {
        return I.Set()
      }
    } else {
      // Now, we might be deleting a whole directory.
      // Remove anything inside that directory
      BundleLoadManager.debug('[FILESYSTEM_EVENT] Removing everything with this URI (including subdirectories if they exist)', uri)

      const removedNodes = I.Set<Fileish>().withMutations(s => {
        // Unload if the user deleted the bundle directory
        if (bundle.absPath.startsWith(uri)) s.add(bundle)
        // Remove if it was a file
        const removedNode = bundle.allBooks.remove(uri) ??
                  bundle.allPages.remove(uri) ??
                  bundle.allImages.remove(uri)
        if (removedNode !== undefined) s.add(bundle)
        // Remove if it was a directory
        const filePathDir = `${uri}${PATH_SEP}`
        s.union(bundle.allBooks.removeByKeyPrefix(filePathDir))
        s.union(bundle.allPages.removeByKeyPrefix(filePathDir))
        s.union(bundle.allImages.removeByKeyPrefix(filePathDir))
      })
      // Unload all removed nodes so users do not think the files still exist
      removedNodes.forEach(n => n.load(undefined))
      return removedNodes
    }
  }

  public updateFileContents(absPath: string, contents: string) {
    const node = findOrCreateNode(this.bundle, absPath)
    if (node === undefined) {
      BundleLoadManager.debug('[DOC_UPDATER] Could not find model for this file so ignoring update events', absPath)
      return
    }
    BundleLoadManager.debug('[DOC_UPDATER] Updating contents of', node.filePath())
    node.update(contents)
    this.sendFileDiagnostics(node)
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

  private sendFileDiagnostics(node: Fileish) {
    const { errors, nodesToLoad } = node.getValidationErrors()
    if (nodesToLoad.isEmpty()) {
      const uri = node.absPath
      const diagnostics = errors.toSet().map(err => {
        const start = err.startPos
        const end = err.endPos
        const range = Range.create(start, end)
        return Diagnostic.create(range, err.message, DiagnosticSeverity.Error)
      }).toArray()
      this.conn.sendDiagnostics({
        uri,
        diagnostics
      })
    } else {
      // push this task back onto the job stack and then add loading jobs for each node that needs to load
      const unloadedNodes = nodesToLoad.filter(n => !n.isLoaded())
      BundleLoadManager.debug('[SEND_DIAGNOSTICS] Dependencies to check validity were not met yet. Enqueuing dependencies and then re-enqueueing this job', node.absPath, unloadedNodes.map(n => n.absPath).toArray())
      jobRunner.enqueue({ type: 'SEND_DELAYED_DIAGNOSTICS', context: node, fn: () => this.sendFileDiagnostics(node) })
      unloadedNodes.forEach(n => jobRunner.enqueue({ type: 'LOAD_DEPENDENCY', context: n, fn: async () => await this.readAndLoad(n) }))
    }
  }

  performInitialValidation() {
    const enqueueLoadJob = (node: Fileish) => jobRunner.enqueue({ slow: true, type: 'INITIAL_LOAD_DEP', context: node, fn: async () => await this.readAndLoad(node) })
    const jobs = [
      { slow: true, type: 'INITIAL_LOAD_BUNDLE', context: this.bundle, fn: async () => await this.readAndLoad(this.bundle) },
      { slow: true, type: 'INITIAL_LOAD_ALL_BOOKS', context: this.bundle, fn: () => this.bundle.allBooks.all().forEach(enqueueLoadJob) },
      { slow: true, type: 'INITIAL_LOAD_ALL_BOOK_ERRORS', context: this.bundle, fn: () => { this.bundle.allBooks.all().forEach(this.sendFileDiagnostics.bind(this)) } },
      { slow: true, type: 'INITIAL_LOAD_ALL_PAGES', context: this.bundle, fn: () => this.bundle.allPages.all().forEach(enqueueLoadJob) },
      { slow: true, type: 'INITIAL_LOAD_ALL_IMAGES', context: this.bundle, fn: () => this.bundle.allImages.all().forEach(enqueueLoadJob) },
      { slow: true, type: 'INITIAL_LOAD_REPORT_VALIDATION', context: this.bundle, fn: async () => await Promise.all(this.bundle.allNodes().map(f => this.sendFileDiagnostics(f))) }
    ]
    jobs.reverse().forEach(j => jobRunner.enqueue(j))
  }

  loadEnoughToSendDiagnostics(context: {workspace: string, doc: string}) {
    // load the books to see if this URI is a page in a book
    const jobs = [
      { type: 'FILEOPENED_LOAD_BUNDLE_DEP', context, fn: async () => await this.readAndLoad(this.bundle) },
      { type: 'FILEOPENED_LOAD_BOOKS_DEP', context, fn: async () => await Promise.all(this.bundle.books().map(async f => await this.readAndLoad(f))) },
      {
        type: 'FILEOPENED_SEND_DIAGNOSTICS',
        context,
        fn: () => {
          const node = findNode(this.bundle, context.doc)
          if (node !== undefined) {
            this.sendFileDiagnostics(node)
          }
        }
      }
    ]
    jobs.reverse().forEach(j => jobRunner.enqueue(j))
  }
}

export interface URIPair { workspace: string, doc: string }
export interface Job {
  type: string
  context: Fileish | URIPair
  fn: () => Promise<any> | any
  slow?: boolean
}

export class JobRunner {
  private _currentPromise: Opt<Promise<void>>
  private readonly fastStack: Job[] = []
  private readonly slowStack: Job[] = []

  public enqueue(job: Job) {
    job.slow === true ? this.slowStack.push(job) : this.fastStack.push(job)
    this.process()
  }

  public async done(): Promise<any> { return this._currentPromise === undefined ? await Promise.resolve() : await this._currentPromise }

  private length() {
    return this.fastStack.length + this.slowStack.length
  }

  private pop(): Opt<Job> {
    return this.fastStack.pop() ?? this.slowStack.pop()
  }

  private process() {
    if (this._currentPromise !== undefined) return // job is running
    this._currentPromise = new Promise((resolve, reject) => {
      setImmediate(() => this.tickWithCb(resolve, reject))
    })
  }

  // In order to support `await this.done()` keep daisy-chaining the ticks
  private tickWithCb(resolve: () => void, reject: () => void) {
    const current = this.pop()
    if (current !== undefined) {
      this.tick(current).then(() => this.tickWithCb(resolve, reject), reject)
    } else {
      resolve()
      this._currentPromise = undefined
    }
  }

  private async tick(current: Job) {
    const [ms] = await profileAsync(async () => {
      const c = expect(current, 'BUG: nothing should have changed in this time')
      BundleLoadManager.debug('[JOB_RUNNER] Starting job', c.type, this.toString(c.context), c.slow === true ? '(slow)' : '(fast)')
      await c.fn()
    })
    BundleLoadManager.debug('[JOB_RUNNER] Finished job', current.type, this.toString(current.context), 'took', ms, 'ms')
    if (this.length() === 0) {
      BundleLoadManager.debug('[JOB_RUNNER] No more pending jobs. Taking a nap.')
    } else {
      BundleLoadManager.debug('[JOB_RUNNER] Remaining jobs', this.length())
    }
  }

  toString(nodeOrString: Fileish | URIPair) {
    if (nodeOrString instanceof Fileish) { return nodeOrString.filePath() } else return path.relative(nodeOrString.workspace, nodeOrString.doc)
  }
}

export const jobRunner = new JobRunner()
