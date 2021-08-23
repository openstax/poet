import { glob } from 'glob'
import fs from 'fs'
import path from 'path'
import I from 'immutable'
import { Connection } from 'vscode-languageserver'
import { CompletionItem, CompletionItemKind, Diagnostic, DiagnosticSeverity, FileChangeType, FileEvent, TextEdit } from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
import { TocTreeModule, TocTreeCollection, TocTreeElement, TocTreeElementType } from '../../common/src/toc-tree'
import { Opt, expectValue, Position, inRange, Range } from './model/utils'
import { BookNode, TocNode, TocNodeKind } from './model/book'
import { Bundle } from './model/bundle'
import { PageNode } from './model/page'
import { Fileish } from './model/fileish'
import { JobRunner } from './job-runner'

// Note: `[^/]+` means "All characters except slash"
const IMAGE_RE = /\/media\/[^/]+\.[^.]+$/
const PAGE_RE = /\/modules\/[^/]+\/index\.cnxml$/
const BOOK_RE = /\/collections\/[^/]+\.collection\.xml$/

const PATH_SEP = path.sep

function findOrCreateNode(bundle: Bundle, absPath: string) {
  if (bundle.absPath === absPath) {
    return bundle
  } else if (IMAGE_RE.test(absPath)) {
    return bundle.allImages.getOrAdd(absPath)
  } else if (PAGE_RE.test(absPath)) {
    return bundle.allPages.getOrAdd(absPath)
  } else if (BOOK_RE.test(absPath)) {
    return bundle.allBooks.getOrAdd(absPath)
  }
}

function findNode(bundle: Bundle, absPath: string) {
  return bundle.absPath === absPath
    ? bundle
    : (
        bundle.allBooks.get(absPath) ??
        bundle.allPages.get(absPath) ??
        bundle.allImages.get(absPath))
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
  const children = book.toc.map(recTocConvert)
  return {
    type: TocTreeElementType.collection,
    title: book.title,
    slug: book.slug,
    children
  }
}

function recTocConvert(node: TocNode): TocTreeElement {
  if (node.type === TocNodeKind.Inner) {
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
    const stat = await fs.promises.stat(fsPath)
    if (stat.isFile()) { // Example: <image src=""/> resolves to 'modules/m123' which is a directory.
      return await fs.promises.readFile(fsPath, 'utf-8')
    }
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
export class ModelManager {
  public static debug: (...args: any[]) => void = console.debug

  public readonly jobRunner = new JobRunner()
  private readonly openDocuments = new Map<string, string>()
  private didLoadOrphans = false

  constructor(public bundle: Bundle, private readonly conn: Connection) {}

  public get allPages() {
    return this.bundle.allPages.all
  }

  public get orphanedPages() {
    const books = this.bundle.books
    return this.bundle.allPages.all.subtract(books.flatMap(b => b.pages))
  }

  public get orphanedImages() {
    const books = this.bundle.books
    const pages = books.flatMap(b => b.pages)
    return this.bundle.allImages.all.filter(i => i.isLoaded && i.exists).subtract(pages.flatMap(p => p.images))
  }

  public async loadEnoughForToc() {
    // The only reason this is not implemented as a Job is because we need to send a timely response to the client
    // and there is no code for being notified when a Job completes
    await this.readAndLoad(this.bundle)
    this.sendFileDiagnostics(this.bundle)

    await Promise.all(this.bundle.books.map(async b => {
      await this.readAndLoad(b)
      this.sendFileDiagnostics(b)
    }))
  }

  public async loadEnoughForOrphans() {
    if (this.didLoadOrphans) return
    await this.loadEnoughForToc()
    // Add all the orphaned Images/Pages/Books dangling around in the filesystem without loading them
    const files = glob.sync('{modules/*/index.cnxml,media/*.*,collections/*.collection.xml}', { cwd: URI.parse(this.bundle.workspaceRoot).fsPath, absolute: true })
    files.forEach(absPath => expectValue(findOrCreateNode(this.bundle, URI.parse(absPath).toString()), `BUG? We found files that the bundle did not recognize: ${absPath}`))
    this.didLoadOrphans = true
  }

  async processFilesystemChange(evt: FileEvent): Promise<I.Set<Fileish>> {
    const { bundle } = this
    const { type, uri } = evt

    // Could be adding an Image/Page/Book, or removing/adding a directory, or adding some other file
    ModelManager.debug(`[FILESYSTEM_EVENT] Start ${toStringFileChangeType(type)} ${uri}`)

    if (type === FileChangeType.Created) {
      // Check if we are adding an Image/Page/Book
      const node = findOrCreateNode(bundle, uri)
      if (node !== undefined) {
        ModelManager.debug('[FILESYSTEM_EVENT] Adding item')
        await this.readAndLoad(node)
        return I.Set([node])
      } else {
        // No, we are adding something unknown. Ignore
        ModelManager.debug('[FILESYSTEM_EVENT] New file did not match anything we understand. Ignoring', uri)
        return I.Set()
      }
    } else if (type === FileChangeType.Changed) {
      const item = findNode(bundle, uri)
      if (item !== undefined) {
        ModelManager.debug('[FILESYSTEM_EVENT] Found item')
        await this.readAndUpdate(item)
        this.sendFileDiagnostics(item)
        return I.Set([item])
      } else {
        return I.Set()
      }
    } else {
      // Now, we might be deleting a whole directory.
      // Remove anything inside that directory
      ModelManager.debug('[FILESYSTEM_EVENT] Removing everything with this URI (including subdirectories if they exist)', uri)

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
      ModelManager.debug('[DOC_UPDATER] Could not find model for this file so ignoring update events', absPath)
      return
    }
    ModelManager.debug('[DOC_UPDATER] Updating contents of', node.workspacePath)
    node.load(contents)
    this.sendFileDiagnostics(node)
    this.openDocuments.set(absPath, contents)
  }

  public closeDocument(absPath: string) {
    this.openDocuments.delete(absPath)
  }

  public getOpenDocContents(absPath: string) {
    return this.openDocuments.get(absPath)
  }

  private async readAndLoad(node: Fileish) {
    if (node.isLoaded) { return }
    const fileContent = await readOrNull(node.absPath)
    node.load(fileContent)
  }

  private async readAndUpdate(node: Fileish) {
    const fileContent = await readOrNull(node.absPath)
    node.load(fileContent)
  }

  private sendFileDiagnostics(node: Fileish) {
    const { errors, nodesToLoad } = node.validationErrors
    if (nodesToLoad.isEmpty()) {
      const uri = node.absPath
      const diagnostics = errors.toSet().map(err => {
        return Diagnostic.create(err.range, err.message, DiagnosticSeverity.Error)
      }).toArray()
      this.conn.sendDiagnostics({
        uri,
        diagnostics
      })
    } else {
      // push this task back onto the job stack and then add loading jobs for each node that needs to load
      const unloadedNodes = nodesToLoad.filter(n => !n.isLoaded)
      ModelManager.debug('[SEND_DIAGNOSTICS] Dependencies to check validity were not met yet. Enqueuing dependencies and then re-enqueueing this job', node.absPath, unloadedNodes.map(n => n.absPath).toArray())
      this.jobRunner.enqueue({ type: 'SEND_DELAYED_DIAGNOSTICS', context: node, fn: () => this.sendFileDiagnostics(node) })
      unloadedNodes.forEach(n => this.jobRunner.enqueue({ type: 'LOAD_DEPENDENCY', context: n, fn: async () => await this.readAndLoad(n) }))
    }
  }

  performInitialValidation() {
    const enqueueLoadJob = (node: Fileish) => this.jobRunner.enqueue({ slow: true, type: 'INITIAL_LOAD_DEP', context: node, fn: async () => await this.readAndLoad(node) })
    const jobs = [
      { slow: true, type: 'INITIAL_LOAD_BUNDLE', context: this.bundle, fn: async () => await this.readAndLoad(this.bundle) },
      { slow: true, type: 'INITIAL_LOAD_ALL_BOOKS', context: this.bundle, fn: () => this.bundle.allBooks.all.forEach(enqueueLoadJob) },
      { slow: true, type: 'INITIAL_LOAD_ALL_BOOK_ERRORS', context: this.bundle, fn: () => { this.bundle.allBooks.all.forEach(this.sendFileDiagnostics.bind(this)) } },
      { slow: true, type: 'INITIAL_LOAD_ALL_PAGES', context: this.bundle, fn: () => this.bundle.allPages.all.forEach(enqueueLoadJob) },
      { slow: true, type: 'INITIAL_LOAD_ALL_IMAGES', context: this.bundle, fn: () => this.bundle.allImages.all.forEach(enqueueLoadJob) },
      { slow: true, type: 'INITIAL_LOAD_REPORT_VALIDATION', context: this.bundle, fn: async () => await Promise.all(this.bundle.allNodes.map(f => this.sendFileDiagnostics(f))) }
    ]
    jobs.reverse().forEach(j => this.jobRunner.enqueue(j))
  }

  loadEnoughToSendDiagnostics(workspaceUri: string, uri: string, content?: string) {
    const context = { workspace: workspaceUri, doc: uri }
    // load the books to see if this URI is a page in a book
    const jobs = [
      { type: 'FILEOPENED_LOAD_BUNDLE_DEP', context, fn: async () => await this.readAndLoad(this.bundle) },
      { type: 'FILEOPENED_LOAD_BOOKS_DEP', context, fn: async () => await Promise.all(this.bundle.books.map(async f => await this.readAndLoad(f))) },
      {
        type: 'FILEOPENED_SEND_DIAGNOSTICS',
        context,
        fn: () => {
          const node = findNode(this.bundle, uri)
          if (node !== undefined) {
            if (content !== undefined) {
              this.updateFileContents(uri, content)
            } else {
              this.sendFileDiagnostics(node)
            }
          }
        }
      }
    ]
    jobs.reverse().forEach(j => this.jobRunner.enqueue(j))
  }

  public autocompleteImages(page: PageNode, cursor: Position) {
    const foundLinks = page.imageLinks.toArray().filter((l) => {
      return inRange(l.range, cursor)
    })

    if (foundLinks.length === 0) { return [] }

    // We're inside an <image> element.
    // Now check and see if we are right at the src=" point
    const content = expectValue(this.getOpenDocContents(page.absPath), 'BUG: This file should be open and have been sent from the vscode client').split('\n')
    const beforeCursor = content[cursor.line].substring(0, cursor.character)
    const afterCursor = content[cursor.line].substring(cursor.character)
    const startQuoteOffset = beforeCursor.lastIndexOf('src="')
    const endQuoteOffset = afterCursor.indexOf('"')
    if (startQuoteOffset >= 0 && endQuoteOffset >= 0) {
      const range: Range = {
        start: { line: cursor.line, character: startQuoteOffset + 'src="'.length },
        end: { line: cursor.line, character: endQuoteOffset + cursor.character }
      }
      expectValue(inRange(range, cursor) ? true : undefined, 'BUG: The cursor must be within the replacement range')
      const tokens = beforeCursor.split(' ')
      if (tokens[tokens.length - 1].startsWith('src="')) {
        const ret = this.orphanedImages.toArray().map(i => {
          const insertText = path.relative(path.dirname(page.absPath), i.absPath)
          const item = CompletionItem.create(insertText)
          item.textEdit = TextEdit.replace(range, insertText)
          item.kind = CompletionItemKind.File
          item.detail = 'Orphaned Image'
          return item
        })
        return ret
      }
    }
    return []
  }
}
