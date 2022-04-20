import { v4 as uuid4 } from 'uuid'
import { glob } from 'glob'
import fs from 'fs'
import * as path from 'path'
import I from 'immutable'
import * as Quarx from 'quarx'
import { Connection } from 'vscode-languageserver'
import { CompletionItem, CompletionItemKind, Diagnostic, DiagnosticSeverity, DocumentLink, FileChangeType, FileEvent, TextEdit } from 'vscode-languageserver-protocol'
import { URI, Utils } from 'vscode-uri'
import { BookToc, ClientTocNode, TocModification, TocModificationKind, TocSubbook, ClientSubbookish, ClientPageish, TocNodeKind, Token, BookRootNode, TocPage } from '../../common/src/toc'
import { Opt, expectValue, Position, inRange, Range, equalsArray, selectOne } from './model/utils'
import { Bundle } from './model/bundle'
import { PageLinkKind, PageNode, PageValidationKind } from './model/page'
import { Fileish } from './model/fileish'
import { JobRunner } from './job-runner'
import { equalsBookToc, equalsClientPageishArray, fromBook, fromPage, IdMap, renameTitle, toString } from './book-toc-utils'
import { BooksAndOrphans, DiagnosticSource, ExtensionServerNotification } from '../../common/src/requests'
import { BookNode, TocSubbookWithRange } from './model/book'
import { mkdirp } from 'fs-extra'
import { DOMParser, XMLSerializer } from 'xmldom'

// Note: `[^/]+` means "All characters except slash"
const IMAGE_RE = /\/media\/[^/]+\.[^.]+$/
const PAGE_RE = /\/modules\/[^/]+\/index\.cnxml$/
const BOOK_RE = /\/collections\/[^/]+\.collection\.xml$/

const PATH_SEP = path.sep

function getSeverity(errMessage: string) {
  switch (errMessage) {
    case PageValidationKind.MISSING_ID:
      return DiagnosticSeverity.Warning
    default:
      return DiagnosticSeverity.Error
  }
}

interface NodeAndParent {node: ClientTocNode, parent: BookToc|ClientTocNode}
function childrenOf(n: ClientTocNode) {
  /* istanbul ignore else */
  if (n.type === TocNodeKind.Subbook) {
    return n.children
  } else {
    throw new Error('BUG: Unreachable code')
  }
}

function loadedAndExists(n: Fileish) {
  return n.isLoaded && n.exists
}

function findOrCreateNode(bundle: Bundle, absPath: string) {
  if (bundle.absPath === absPath) {
    return bundle
  } else if (IMAGE_RE.test(absPath)) {
    return bundle.allResources.getOrAdd(absPath)
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
        bundle.allResources.get(absPath))
}

export function pageToModuleId(page: PageNode) {
  // /path/to/modules/m123456/index.cnxml
  return path.basename(path.dirname(page.absPath))
}

// https://stackoverflow.com/a/35008327
const checkFileExists = async (s: string): Promise<boolean> => {
  try {
    await fs.promises.access(s, fs.constants.F_OK)
    return true
  } catch {
    return false
  }
}

function toStringFileChangeType(t: FileChangeType) {
  switch (t) {
    case FileChangeType.Changed: return 'CHANGED'
    case FileChangeType.Created: return 'CREATED'
    case FileChangeType.Deleted: return 'DELETED'
  }
}

// In Quarx, whenever the inputs change autorun is executed.
// But: sometimes the inputs change in ways that do not affect the resulting objects (like the column number of an <image> tag)
//
// This splits the sideEffect from the re-compute function so that sideEffectFn only runs when the input to the sideEffectFn changes
function memoizeTempValue<T>(equalsFn: (a: T, b: T) => boolean, computeFn: () => T, sideEffectFn: (arg: T) => void) {
  const temp = Quarx.observable.box<Opt<{matryoshka: T}>>(undefined, { equals: matryoshkaEquals(equalsFn) })
  Quarx.autorun(() => {
    temp.set({ matryoshka: computeFn() })
  })
  Quarx.autorun(() => {
    const m = temp.get()
    /* istanbul ignore else */
    if (m !== undefined) {
      sideEffectFn(m.matryoshka)
    }
  })
}
const matryoshkaEquals = <T>(eq: (n1: T, n2: T) => boolean) => (n1: Opt<{matryoshka: T}>, n2: Opt<{matryoshka: T}>) => {
  /* istanbul ignore next */
  if (n1 === undefined && n2 === undefined) return true
  if (n1 !== undefined && n2 !== undefined) {
    return eq(n1.matryoshka, n2.matryoshka)
  } return false
}
const equalsBookTocArray = equalsArray(equalsBookToc)
const equalsBooksAndOrphans = (n1: BooksAndOrphans, n2: BooksAndOrphans) => {
  return equalsBookTocArray(n1.books, n2.books) && equalsClientPageishArray(n1.orphans, n2.orphans)
}
export class ModelManager {
  public static debug: (...args: any[]) => void = console.debug

  public readonly jobRunner = new JobRunner()
  private readonly openDocuments = new Map<string, string>()
  private didLoadOrphans = false
  private bookTocs: BookToc[] = []
  private tocIdMap = new IdMap<string, TocSubbookWithRange|PageNode>(x => {
    /* istanbul ignore next */
    throw new Error('BUG: has not been set yet')
  })

  constructor(public bundle: Bundle, private readonly conn: Connection, bookTocHandler?: (params: BooksAndOrphans) => void) {
    const defaultHandler = (params: BooksAndOrphans) => conn.sendNotification(ExtensionServerNotification.BookTocs, params)
    const handler = bookTocHandler ?? defaultHandler
    // BookTocs
    const computeFn = () => {
      let idCounter = 0
      const tocIdMap = new IdMap<string, TocSubbookWithRange|PageNode>((v) => {
        if (v instanceof PageNode) {
          return `servertoken:page:${v.absPath}`
        } else {
          return `servertoken:inner:${idCounter++}:${v.title}`
        }
      })
      if (loadedAndExists(this.bundle)) {
        return {
          tocIdMap,
          books: this.bundle.books.filter(loadedAndExists).toArray().map(b => fromBook(tocIdMap, b)),
          orphans: this.orphanedPages.filter(loadedAndExists).toArray().map(p => fromPage(tocIdMap, p).value)
        }
      }
      ModelManager.debug('[MODEL_MANAGER] bundle file is not loaded yet or does not exist')
      return { tocIdMap, books: [], orphans: [] }
    }
    const sideEffectFn = (v: BooksAndOrphans & {tocIdMap: IdMap<string, TocSubbookWithRange|PageNode>}) => {
      this.tocIdMap = v.tocIdMap
      this.bookTocs = v.books
      const params: BooksAndOrphans = {
        books: v.books,
        orphans: v.orphans
      }
      ModelManager.debug('[MODEL_MANAGER] Sending Book TOC Updated', params)
      handler(params)
    }
    memoizeTempValue(equalsBooksAndOrphans, computeFn, sideEffectFn)
  }

  public get allPages() {
    return this.bundle.allPages.all
  }

  public get orphanedPages() {
    const books = this.bundle.books.filter(loadedAndExists)
    return this.bundle.allPages.all.filter(loadedAndExists).subtract(books.flatMap(b => b.pages))
  }

  public get orphanedResources() {
    const books = this.bundle.books.filter(loadedAndExists)
    const pages = books.flatMap(b => b.pages)
    return this.bundle.allResources.all.filter(loadedAndExists).subtract(pages.flatMap(p => p.resources))
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
    const files = glob.sync('{modules/*/index.cnxml,media/*.*,collections/*.collection.xml}', { cwd: URI.parse(this.bundle.workspaceRootUri).fsPath, absolute: true })
    Quarx.batch(() => {
      files.forEach(absPath => expectValue(findOrCreateNode(this.bundle, this.bundle.pathHelper.canonicalize(absPath)), `BUG? We found files that the bundle did not recognize: ${absPath}`))
    })
    // Load everything before we can know where the orphans are
    this.performInitialValidation()
    await this.jobRunner.done()
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
                  bundle.allResources.remove(uri)
        if (removedNode !== undefined) s.add(removedNode)
        // Remove if it was a directory
        const filePathDir = `${uri}${PATH_SEP}`
        s.union(bundle.allBooks.removeByKeyPrefix(filePathDir))
        s.union(bundle.allPages.removeByKeyPrefix(filePathDir))
        s.union(bundle.allResources.removeByKeyPrefix(filePathDir))
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

  private async readOrNull(node: Fileish): Promise<Opt<string>> {
    const uri = node.absPath
    const unsavedContents = this.getOpenDocContents(uri)
    if (unsavedContents !== undefined) {
      return unsavedContents
    }
    const { fsPath } = URI.parse(uri)
    if (await checkFileExists(fsPath)) {
      const stat = await fs.promises.stat(fsPath)
      if (stat.isFile()) { // Example: <image src=""/> resolves to 'modules/m123' which is a directory.
        return await fs.promises.readFile(fsPath, 'utf-8')
      }
    }
  }

  private async readAndLoad(node: Fileish) {
    if (node.isLoaded) { return }
    const fileContent = await this.readOrNull(node)
    node.load(fileContent)
  }

  private async readAndUpdate(node: Fileish) {
    const fileContent = await this.readOrNull(node)
    node.load(fileContent)
  }

  private sendFileDiagnostics(node: Fileish) {
    const { errors, nodesToLoad } = node.validationErrors
    if (nodesToLoad.isEmpty()) {
      const uri = node.absPath
      const diagnostics = errors.toSet().map(err => {
        const severity = getSeverity(err.message)
        return Diagnostic.create(err.range, err.message, severity, undefined, DiagnosticSource.cnxml)
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
      { slow: true, type: 'INITIAL_LOAD_ALL_RESOURCES', context: this.bundle, fn: () => this.bundle.allResources.all.forEach(enqueueLoadJob) },
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

  public autocompleteResources(page: PageNode, cursor: Position) {
    const foundLinks = page.resourceLinks.toArray().filter((l) => {
      return inRange(l.range, cursor)
    })

    if (foundLinks.length === 0) { return [] }

    // We're inside an <image> or <iframe> element.
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
      const ret = this.orphanedResources.toArray().map(i => {
        const insertText = path.relative(path.dirname(page.absPath), i.absPath)
        const item = CompletionItem.create(insertText)
        item.textEdit = TextEdit.replace(range, insertText)
        item.kind = CompletionItemKind.File
        item.detail = 'Orphaned Resource'
        return item
      })
      return ret
    }
    return []
  }

  async getDocumentLinks(page: PageNode) {
    await this.readAndLoad(page)
    const ret: DocumentLink[] = []
    for (const pageLink of page.pageLinks) {
      if (pageLink.type === PageLinkKind.URL) {
        ret.push(DocumentLink.create(pageLink.range, pageLink.url))
      } else {
        const targetPage = pageLink.page
        if (targetPage.isLoaded && !targetPage.exists) {
          continue
        }
        let target = targetPage.absPath
        if (pageLink.type === PageLinkKind.PAGE_ELEMENT) {
          await this.readAndLoad(targetPage)
          const loc = targetPage.elementIds.get(pageLink.targetElementId)
          if (loc !== undefined) {
            target = `${target}#${loc.range.start.line + 1}:${loc.range.start.character}`
          }
        }
        ret.push(DocumentLink.create(pageLink.range, target))
      }
    }
    return ret
  }

  async modifyToc(evt: TocModification) {
    ModelManager.debug('[MODIFY_TOC]', evt)

    const bookToc = this.bookTocs[evt.bookIndex]
    const book = expectValue(this.bundle.allBooks.get(bookToc.absPath), 'BUG: Book no longer exists')
    const nodeAndParent = this.lookupToken(evt.nodeToken)

    if (nodeAndParent !== undefined) {
      // We are manipulating an item in a Book ToC
      const { node, parent } = nodeAndParent
      if (evt.type === TocModificationKind.PageRename || evt.type === TocModificationKind.SubbookRename) {
        if (node.type === TocNodeKind.Page) {
          const page = expectValue(this.bundle.allPages.get(node.value.absPath), `BUG: This node should exist: ${node.value.absPath}`)
          const fsPath = URI.parse(node.value.absPath).fsPath
          const oldXml = expectValue(await this.readOrNull(page), `BUG? This file should exist right? ${fsPath}`)
          const newXml = renameTitle(evt.newTitle, oldXml)
          await fs.promises.writeFile(fsPath, newXml)
          page.load(newXml) // Just speed up the process
        } else {
          node.value.title = evt.newTitle
          await writeBookToc(book, bookToc)
        }
      } else if (evt.type === TocModificationKind.Remove) {
        removeNode(parent, node)
        await writeBookToc(book, bookToc)
      } else /* istanbul ignore else */ if (evt.type === TocModificationKind.Move) {
        removeNode(parent, node)
        // Add the node
        const newParentChildren = evt.newParentToken !== undefined ? childrenOf(expectValue(this.lookupToken(evt.newParentToken), 'BUG: should always have a parent').node) : bookToc.tocTree
        newParentChildren.splice(evt.newChildIndex, 0, node)
        await writeBookToc(book, bookToc)
      }
    } else /* istanbul ignore else */ if (evt.type === TocModificationKind.Move) {
      // We are manipulating an orphaned Page (probably moving it into the ToC of a book)
      const pageNode = expectValue(this.tocIdMap.getValue(evt.nodeToken), `BUG: Should have found an item with key '${evt.nodeToken}' in the ToC idMap but did not. Maybe the client is stale?`)
      /* istanbul ignore else */
      if (pageNode instanceof PageNode) {
        const node: TocPage<ClientPageish> = {
          type: TocNodeKind.Page,
          value: {
            token: evt.nodeToken,
            title: pageNode.optTitle,
            fileId: pageToModuleId(pageNode),
            absPath: pageNode.absPath
          }
        }
        // Add the node
        /* istanbul ignore next */
        const newParentChildren = evt.newParentToken !== undefined ? childrenOf(expectValue(this.lookupToken(evt.newParentToken), 'BUG: should always have a parent').node) : bookToc.tocTree
        newParentChildren.splice(evt.newChildIndex, 0, node)
        await writeBookToc(book, bookToc)
      } else {
        throw new Error(`BUG: The orphaned item being dragged around was not a PageNode. nodeToken='${evt.nodeToken}' That is really unexpected. Maybe the client is stale?`)
      }
    } else {
      throw new Error(`BUG: The operation '${evt.type}' is not yet implemented for the orphaned item with nodeToken='${evt.nodeToken}'`)
    }
  }

  private recFind(token: Token, parent: ClientTocNode | BookToc, nodes: ClientTocNode[]): Opt<NodeAndParent> {
    for (const node of nodes) {
      if (node.value.token === token) {
        return { node: node, parent }
      }
      /* istanbul ignore else */
      if (node.type === TocNodeKind.Subbook) {
        const ret = this.recFind(token, node, node.children)
        if (ret !== undefined) return ret
      }
    }
  }

  private lookupToken(token: string): Opt<NodeAndParent> {
    for (const b of this.bookTocs) {
      const ret = this.recFind(token, b, b.tocTree)
      /* istanbul ignore else */
      if (ret !== undefined) return ret
    }
  }

  public async createPage(bookIndex: number, title: string) {
    const template = (): string => {
      return `
<document xmlns="http://cnx.rice.edu/cnxml">
  <title/>
  <metadata xmlns:md="http://cnx.rice.edu/mdml">
    <md:title/>
    <md:content-id/>
    <md:uuid/>
  </metadata>
  <content>
  </content>
</document>`.trim()
    }
    const workspaceRootUri = URI.parse(this.bundle.workspaceRootUri)
    const pageDirUri = Utils.joinPath(workspaceRootUri, 'modules')
    let moduleNumber = 0
    const moduleDirs = new Set(await fs.promises.readdir(pageDirUri.fsPath))
    while (moduleNumber < 1000) {
      moduleNumber += 1
      const newModuleId = `m${moduleNumber.toString().padStart(5, '0')}`
      if (moduleDirs.has(newModuleId)) {
        // File exists already, try again
        continue
      }
      const pageUri = Utils.joinPath(pageDirUri, newModuleId, 'index.cnxml')
      const page = this.bundle.allPages.getOrAdd(pageUri.fsPath) // fsPath works for tests and gets converted to file:// for real

      const doc = new DOMParser().parseFromString(template(), 'text/xml')
      selectOne('/cnxml:document/cnxml:title', doc).textContent = title
      selectOne('/cnxml:document/cnxml:metadata/md:title', doc).textContent = title
      selectOne('/cnxml:document/cnxml:metadata/md:content-id', doc).textContent = newModuleId
      selectOne('/cnxml:document/cnxml:metadata/md:uuid', doc).textContent = uuid4()
      const xmlStr = new XMLSerializer().serializeToString(doc)

      page.load(xmlStr)
      await mkdirp(Utils.joinPath(pageDirUri, newModuleId).fsPath)
      await fs.promises.writeFile(pageUri.fsPath, xmlStr)
      ModelManager.debug(`[NEW_PAGE] Created: ${pageUri.fsPath}`)

      const bookToc = this.bookTocs[bookIndex]
      const book = expectValue(this.bundle.allBooks.get(bookToc.absPath), 'BUG: Book no longer exists')
      bookToc.tocTree.unshift({
        type: TocNodeKind.Page,
        value: { token: 'unused-when-writing', title: undefined, fileId: newModuleId, absPath: page.absPath }
      })
      await writeBookToc(book, bookToc)
      ModelManager.debug(`[CREATE_PAGE] Prepended to Book: ${pageUri.fsPath}`)
      return { page, id: newModuleId }
    }
    /* istanbul ignore next */
    throw new Error('Error: Too many page directories already exist')
  }

  public async createSubbook(bookIndex: number, title: string) {
    ModelManager.debug(`[CREATE_SUBBOOK] Creating: ${title}`)
    const bookToc = this.bookTocs[bookIndex]
    const book = expectValue(this.bundle.allBooks.get(bookToc.absPath), 'BUG: Book no longer exists')
    const tocNode: TocSubbook<ClientSubbookish, ClientPageish> = {
      type: TocNodeKind.Subbook,
      value: { title, token: 'unused-when-writing' },
      children: []
    }
    // Prepend new Subbook to top of Book so it is visible to the user
    bookToc.tocTree.unshift(tocNode)
    await writeBookToc(book, bookToc)
  }

  public async modifyFileish(node: Fileish, fn: (input: string) => string) {
    const fileContents = expectValue(await this.readOrNull(node), `BUG? This file should exist right? ${node.absPath}`)
    const out = fn(fileContents)

    ModelManager.debug('[DOC_UPDATER] Updating contents of', node.workspacePath)
    node.load(out)
    this.sendFileDiagnostics(node)

    const fsPath = URI.parse(node.absPath).fsPath
    await fs.promises.writeFile(fsPath, out)
  }
}

export function removeNode(parent: ClientTocNode | BookToc, node: ClientTocNode) {
  if (parent.type === BookRootNode.Singleton) {
    const before = parent.tocTree.length
    parent.tocTree = parent.tocTree.filter(n => n !== node)
    /* istanbul ignore if */
    if (parent.tocTree.length === before) {
      throw new Error(`BUG: Could not find Page child in book='${parent.slug}'`)
    }
  } else /* istanbul ignore else */ if (parent.type === TocNodeKind.Subbook) {
    const before = parent.children.length
    parent.children = parent.children.filter(n => n !== node)
    /* istanbul ignore if */
    if (parent.children.length === before) {
      throw new Error(`BUG: Could not find Page child in parent='${parent.value.title}'`)
    }
  } else {
    throw new Error('BUG: Unreachable')
  }
}

export async function writeBookToc(book: BookNode, bookToc: BookToc) {
  const bookXmlStr = toString(bookToc)
  const fsPath = URI.parse(bookToc.absPath).fsPath
  await fs.promises.writeFile(fsPath, bookXmlStr)
  book.load(bookXmlStr) // Just speed up the process
  return book
}
