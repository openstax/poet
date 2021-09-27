import expect from 'expect'
import path from 'path'
import mockfs from 'mock-fs'
import SinonRoot from 'sinon'
import I from 'immutable'
import { createConnection, WatchDog } from 'vscode-languageserver'
import { FileChangeType, Logger, ProtocolConnection, PublishDiagnosticsParams } from 'vscode-languageserver-protocol'
import xmlFormat from 'xml-formatter'
import { expectValue, Opt, join, PathKind } from './model/utils'
import { Bundle } from './model/bundle'
import { ModelManager } from './model-manager'
import { first, FS_PATH_HELPER, ignoreConsoleWarnings, loadSuccess, makeBundle } from './model/util.spec'
import { Job, JobRunner } from './job-runner'
import { PageInfo, pageMaker } from './model/page.spec'

import { PageNode } from './model/page'
import { TocModification, TocModificationKind, TocNodeKind } from '../../common/src/toc-tree'
import { BooksAndOrphans, DiagnosticSource } from '../../common/src/requests'
import { bookMaker } from './model/book.spec'
import { bundleMaker } from './model/bundle.spec'

ModelManager.debug = () => {} // Turn off logging
JobRunner.debug = () => {} // Turn off logging

// xml-formatter calls require('xml-parser-xo') _inside_ the format function
// so we need require to cache it before we start up mock-fs
xmlFormat('<root/>')

describe('Bundle Manager', () => {
  const sinon = SinonRoot.createSandbox()
  let manager = null as unknown as ModelManager
  let sendDiagnosticsStub = null as unknown as SinonRoot.SinonStub<[params: PublishDiagnosticsParams], void>

  beforeEach(() => {
    const bundle = makeBundle()
    manager = new ModelManager(bundle, conn)
    sendDiagnosticsStub = sinon.stub(conn, 'sendDiagnostics')
  })
  afterEach(() => {
    sinon.restore()
    sinon.reset()
    sinon.resetBehavior()
    sinon.resetHistory()
  })
  it('responds with all pages when the books have loaded', () => {
    // Nothing loaded yet
    expect(manager.allPages.toArray()).toEqual([])
    // Load the pages
    const book = loadSuccess(first(loadSuccess(manager.bundle).books))
    loadSuccess(first(book.pages))
    expect(manager.allPages.size).toBe(1)
  })
  it('orphanedPages()', () => {
    loadSuccess(first(loadSuccess(manager.bundle).books))
    expect(manager.allPages.size).toBe(1)
    expect(manager.orphanedPages.toArray()).toEqual([])
    const orphanedPage = manager.bundle.allPages.getOrAdd('path/to/orphaned/page')
    expect(manager.allPages.size).toBe(2)
    expect(manager.orphanedPages.toArray()).toEqual([]) // We did not load the file yet
    orphanedPage.load(pageMaker({}))
    expect(manager.orphanedPages.size).toBe(1)
    expect(manager.orphanedPages.first()).toBe(orphanedPage)
  })
  it('updateFileContents()', () => {
    const enqueueStub = sinon.stub(manager.jobRunner, 'enqueue')
    loadSuccess(manager.bundle)
    manager.updateFileContents(manager.bundle.absPath, 'I am not XML so a Parse Error should be sent to diagnostics')
    expect(sendDiagnosticsStub.callCount).toBe(1)
    expect(enqueueStub.callCount).toBe(0)

    // Non-existent node
    manager.updateFileContents('path/to/non-existent/image', 'some bits')
    expect(sendDiagnosticsStub.callCount).toBe(1)
    expect(enqueueStub.callCount).toBe(0)
  })
  it('loadEnoughForToc()', async () => {
    const enqueueStub = sinon.stub(manager.jobRunner, 'enqueue')
    expect(enqueueStub.callCount).toBe(0)
    await manager.loadEnoughForToc()
    // Assumes the test data has 1 Book with 1 Page in it
    // 4 =
    //   1 Load Book as a dependency
    // + 1 Re-validate the Bundle
    // + 1 Load Page as a Book dependency
    // + 1 Re-validate the book
    expect(enqueueStub.callCount).toBe(4)
  })
  it('performInitialValidation()', async () => {
    expect(manager.bundle.isLoaded).toBe(false)
    manager.performInitialValidation()
    await manager.jobRunner.done()

    expect(manager.bundle.allNodes.size).toBe(1 + 1 + 1) // bundle + book + page
    manager.bundle.allNodes.forEach(n => expect(n.isLoaded).toBe(true))
  })
  it('loadEnoughToSendDiagnostics() sends diagnostics for a file we recognize', async () => {
    manager.loadEnoughToSendDiagnostics(manager.bundle.workspaceRootUri, manager.bundle.absPath)
    await manager.jobRunner.done()

    expect(sendDiagnosticsStub.callCount).toBe(1)
    expect(manager.bundle.validationErrors.nodesToLoad.toArray()).toEqual([])

    // Bundle needs to load all the books
    const books = manager.bundle.books
    expect(books.size).toBe(1)
    books.forEach(b => expect(b.isLoaded).toBe(true))
  })
  it('loadEnoughToSendDiagnostics() does not send diagnostics for a file we do not recognize', async () => {
    manager.loadEnoughToSendDiagnostics(manager.bundle.workspaceRootUri, '/path/t/non-existent/file')
    await manager.jobRunner.done()
    expect(sendDiagnosticsStub.callCount).toBe(0)
  })
  it('loadEnoughToSendDiagnostics() loads the node with the contents of the file', async () => {
    manager.loadEnoughToSendDiagnostics(manager.bundle.workspaceRootUri, manager.bundle.absPath, bundleMaker({}))
    await manager.jobRunner.done()
    expect(manager.bundle.books.toArray()).toEqual([])
  })
  it('calls sendDiagnostics with objects that can be serialized (no cycles)', () => {
    ignoreConsoleWarnings(() => manager.updateFileContents(manager.bundle.absPath, '<notvalidXML'))
    expect(sendDiagnosticsStub.callCount).toBe(1)
    const diagnosticsObj = sendDiagnosticsStub.getCall(0).args[0]
    expect(diagnosticsObj.uri).toBeTruthy()
    expect(diagnosticsObj.diagnostics).toBeTruthy()
    expect(() => JSON.stringify(diagnosticsObj)).not.toThrow()
  })
  it('populates the Diagnostics.source field so that pushContent can filter on it', () => {
    loadSuccess(manager.bundle)
    manager.updateFileContents(manager.bundle.absPath, 'I am not XML so a Parse Error should be sent to diagnostics')
    expect(sendDiagnosticsStub.callCount).toBe(1)
    expect(sendDiagnosticsStub.firstCall.args[0].diagnostics[0].source).toBe(DiagnosticSource.cnxml)
  })
})

describe('Unexpected files/directories', () => {
  const sinon = SinonRoot.createSandbox()
  let manager = null as unknown as ModelManager

  beforeEach(() => {
    mockfs({
      'META-INF/books.xml/some-file': 'the file does not matter, ensuring books.xml is a directory does matter'
    })
    manager = new ModelManager(new Bundle(FS_PATH_HELPER, process.cwd()), conn)
    sinon.stub(conn, 'sendDiagnostics')
  })
  afterEach(() => {
    mockfs.restore()
    sinon.restore()
    sinon.reset()
    sinon.resetBehavior()
    sinon.resetHistory()
  })

  it('path is to a directory instead of a file', async () => {
    await expect(async () => await manager.loadEnoughForToc()).rejects.toThrow(/^Object has not been loaded yet \[/)
    expect(manager.bundle.exists).toBe(false)
  })
})

describe('Open Document contents cache', () => {
  const sinon = SinonRoot.createSandbox()

  beforeEach(() => {
    sinon.stub(conn, 'sendDiagnostics')
  })
  afterEach(() => {
    sinon.restore()
  })

  it('Updates the cached contents', () => {
    const manager = new ModelManager(makeBundle(), conn)
    manager.updateFileContents(manager.bundle.absPath, 'value_1')
    expect(manager.getOpenDocContents(manager.bundle.absPath)).toBe('value_1')
    manager.updateFileContents(manager.bundle.absPath, 'value_2')
    expect(manager.getOpenDocContents(manager.bundle.absPath)).toBe('value_2')
    manager.closeDocument(manager.bundle.absPath)
    expect(manager.getOpenDocContents(manager.bundle.absPath)).toBe(undefined)
  })
})

describe('Find orphaned files', () => {
  const sinon = SinonRoot.createSandbox()
  beforeEach(() => {
    mockfs({
      'META-INF/books.xml': bundleMaker({}),
      'modules/m2468/index.cnxml': pageMaker({}),
      'modules/m1357/index.cnxml': pageMaker({})
    })
  })
  afterEach(() => {
    mockfs.restore()
    sinon.restore()
  })
  it('finds orphaned Pages', async () => {
    sinon.stub(conn, 'sendDiagnostics')
    const manager = new ModelManager(new Bundle(FS_PATH_HELPER, process.cwd()), conn)
    await manager.loadEnoughForOrphans()
    // Run again to verify we do not perform the expensive fetch again (via code coverage)
    await manager.loadEnoughForOrphans()
    expect(manager.orphanedPages.size).toBe(2)
  })
})

describe('processFilesystemChange()', () => {
  const sinon = SinonRoot.createSandbox()
  let manager = null as unknown as ModelManager
  let sendDiagnosticsStub = null as unknown as SinonRoot.SinonStub<[params: PublishDiagnosticsParams], void>
  let enqueueStub = null as unknown as SinonRoot.SinonStub<[job: Job], void>

  async function fireChange(type: FileChangeType, filePath: string) {
    const rootUri = FS_PATH_HELPER.join(FS_PATH_HELPER.dirname(manager.bundle.absPath), '..')
    return await manager.processFilesystemChange({ type, uri: FS_PATH_HELPER.join(rootUri, filePath) })
  }

  beforeEach(() => {
    const bookSlug = 'slug2'
    const pageId = 'm1234'
    mockfs({
      'META-INF/books.xml': bundleMaker({ books: [bookSlug] }),
      'collections/slug2.collection.xml': bookMaker({ slug: bookSlug, toc: [{ title: 'subcollection', children: [pageId] }] }),
      'modules/m1234/index.cnxml': pageMaker({})
    })
    const bundle = new Bundle(FS_PATH_HELPER, process.cwd())
    manager = new ModelManager(bundle, conn)
    sendDiagnosticsStub = sinon.stub(conn, 'sendDiagnostics')
    enqueueStub = sinon.stub(manager.jobRunner, 'enqueue')
  })
  afterEach(() => {
    mockfs.restore()
    sinon.restore()
    sinon.reset()
    sinon.resetBehavior()
    sinon.resetHistory()
  })
  it('creates Images/Pages/Books', async () => {
    // Verify each type of object gets loaded
    expect(manager.bundle.isLoaded).toBe(false)
    expect((await fireChange(FileChangeType.Created, 'META-INF/books.xml')).size).toBe(1)
    expect(manager.bundle.isLoaded).toBe(true)

    expect((await fireChange(FileChangeType.Created, 'collections/slug2.collection.xml')).size).toBe(1)
    expect((await fireChange(FileChangeType.Created, 'modules/m1234/index.cnxml')).size).toBe(1)
    expect((await fireChange(FileChangeType.Created, 'media/newpic.png')).size).toBe(1)
  })
  it('does not create things it does not understand', async () => {
    expect((await fireChange(FileChangeType.Created, 'README.md')).toArray()).toEqual([])
  })
  it('updates Images/Pages/Books', async () => {
    expect((await fireChange(FileChangeType.Changed, 'META-INF/books.xml')).size).toBe(1)
    expect(sendDiagnosticsStub.callCount).toBe(0)
    expect(enqueueStub.callCount).toBe(2) // There is one book and 1 re-enqueue

    expect((await fireChange(FileChangeType.Changed, 'collections/slug2.collection.xml')).size).toBe(1)
    expect(sendDiagnosticsStub.callCount).toBe(0)

    expect((await fireChange(FileChangeType.Changed, 'modules/m1234/index.cnxml')).size).toBe(1)
    expect(sendDiagnosticsStub.callCount).toBe(1)

    expect((await fireChange(FileChangeType.Changed, 'media/newpic.png')).toArray()).toEqual([]) // Since the model was not aware of the file yet
  })
  it('deletes Files and directories', async () => {
    // Load the Bundle, Book, and Page
    loadSuccess(first(loadSuccess(first(loadSuccess(manager.bundle).books)).pages))

    // Delete non-existent file
    expect((await fireChange(FileChangeType.Deleted, 'media/newpic.png')).toArray()).toEqual([])
    // Delete a file
    const deletedModules = await fireChange(FileChangeType.Deleted, 'modules/m1234/index.cnxml')
    expect(deletedModules.size).toBe(1)
    expect(first(deletedModules)).toBeInstanceOf(PageNode)
    // Delete a directory
    expect((await fireChange(FileChangeType.Deleted, 'collections')).size).toBe(1)
    expect(sendDiagnosticsStub.callCount).toBe(0)

    // Delete everything (including the bundle)
    expect((await fireChange(FileChangeType.Deleted, '')).size).toBe(1)
    expect(manager.bundle.exists).toBe(false)
  })
  it('deletes Image/Page/Book', async () => {
    // Load the Bundle, Book, and Page
    const bundle = loadSuccess(manager.bundle)
    const book = loadSuccess(first(bundle.books))
    const page = loadSuccess(first(book.pages))

    expect((await fireChange(FileChangeType.Deleted, book.workspacePath)).size).toBe(1)
    expect((await fireChange(FileChangeType.Deleted, page.workspacePath)).size).toBe(1)
    expect((await fireChange(FileChangeType.Deleted, bundle.workspacePath)).size).toBe(1)
  })
  it('Uses the unsaved content even when a filesystem change event occurs', async () => {
    // Load the Bundle, Book, and Page
    const bundle = loadSuccess(manager.bundle)
    const book = loadSuccess(first(bundle.books))

    expect(manager.bundle.books.toArray()).toEqual([book])
    manager.updateFileContents(manager.bundle.absPath, bundleMaker({}))
    expect(manager.bundle.books.toArray()).toEqual([])
    expect((await fireChange(FileChangeType.Changed, 'META-INF/books.xml')).size).toBe(1)
    expect(manager.bundle.books.toArray()).toEqual([]) // Should still be empty because the unsaved changes
  })
})

describe('Image Autocomplete', () => {
  const sinon = SinonRoot.createSandbox()
  let manager = null as unknown as ModelManager

  function joinPath(page: PageNode, relPath: string) {
    return join(FS_PATH_HELPER, PathKind.ABS_TO_REL, page.absPath, relPath)
  }

  beforeEach(() => {
    const bundle = makeBundle()
    manager = new ModelManager(bundle, conn)
  })

  afterEach(() => {
    sinon.restore()
  })

  it('Returns only orphaned images', () => {
    const page = first(loadSuccess(first(loadSuccess(manager.bundle).books)).pages)

    const imagePath = '../../media/image.png'
    const orphanedPath = '../../media/orphan.png'

    const existingImage = manager.bundle.allImages.getOrAdd(joinPath(page, imagePath))
    const orphanedImage = manager.bundle.allImages.getOrAdd(joinPath(page, orphanedPath))
    existingImage.load('image-bits')
    orphanedImage.load('image-bits')

    manager.updateFileContents(page.absPath, pageMaker({ imageHrefs: [imagePath] }))
    expect(page.validationErrors.nodesToLoad.toArray()).toEqual([])
    expect(page.validationErrors.errors.toArray()).toEqual([])

    expect(page.imageLinks.size).toBe(1)
    const firstImageRef = first(page.imageLinks)
    const results = manager.autocompleteImages(page, { line: firstImageRef.range.start.line, character: firstImageRef.range.start.character + '<image src="X'.length })
    expect(results).not.toEqual([])
    expect(results[0].label).toBe(orphanedPath)
  })

  it('Returns no results outside image tag', () => {
    const page = first(loadSuccess(first(loadSuccess(manager.bundle).books)).pages)

    const imagePath = '../../media/image.png'
    const orphanedPath = '../../media/orphan.png'

    const existingImage = manager.bundle.allImages.getOrAdd(joinPath(page, imagePath))
    const orphanedImage = manager.bundle.allImages.getOrAdd(joinPath(page, orphanedPath))
    existingImage.load('image-bits')
    orphanedImage.load('image-bits')

    manager.updateFileContents(page.absPath, pageMaker({ imageHrefs: [imagePath] }))
    expect(page.validationErrors.nodesToLoad.toArray()).toEqual([])
    expect(page.validationErrors.errors.toArray()).toEqual([])

    const cursor = { line: 0, character: 0 }
    const results = manager.autocompleteImages(page, cursor)
    expect(results).toEqual([])
  })

  it('Returns no results outside replacement range', () => {
    const page = first(loadSuccess(first(loadSuccess(manager.bundle).books)).pages)

    const imagePath = '../../media/image.png'
    const orphanedPath = '../../media/orphan.png'
    const missingPath = ''

    const existingImage = manager.bundle.allImages.getOrAdd(joinPath(page, imagePath))
    const orphanedImage = manager.bundle.allImages.getOrAdd(joinPath(page, orphanedPath))
    const missingImage = manager.bundle.allImages.getOrAdd(joinPath(page, missingPath))
    existingImage.load('image-bits')
    orphanedImage.load('image-bits')
    missingImage.load('')

    manager.updateFileContents(page.absPath, pageMaker({ imageHrefs: [imagePath, missingPath] }))
    expect(page.validationErrors.nodesToLoad.toArray()).toEqual([])
    expect(page.validationErrors.errors.toArray()).toEqual([])

    const secondImageRef = page.imageLinks.toArray()[1]
    const results = manager.autocompleteImages(page, { line: secondImageRef.range.start.line, character: secondImageRef.range.start.character + '<image'.length })
    expect(results).toEqual([])
  })
})

describe('documentLinks()', () => {
  let manager = null as unknown as ModelManager

  beforeEach(() => {
    const bundle = makeBundle()
    manager = new ModelManager(bundle, conn)
  })
  it('returns url, page, and page-with-target links', async () => {
    const bundle = makeBundle()
    manager = new ModelManager(bundle, conn)

    const page = first(loadSuccess(first(loadSuccess(manager.bundle).books)).pages)
    const otherId = 'm2468'
    const nonexistentButLoadedId = 'mDoesNotExist'
    const otherPagePath = FS_PATH_HELPER.join(FS_PATH_HELPER.dirname(FS_PATH_HELPER.dirname(page.absPath)), otherId, 'index.cnxml')
    const nonexistentButLoadedPath = FS_PATH_HELPER.join(FS_PATH_HELPER.dirname(FS_PATH_HELPER.dirname(page.absPath)), nonexistentButLoadedId, 'index.cnxml')
    const otherPage = manager.bundle.allPages.getOrAdd(otherPagePath)
    const nonexistentButLoadedPage = manager.bundle.allPages.getOrAdd(nonexistentButLoadedPath)

    otherPage.load(pageMaker({
      elementIds: ['other-el-id']
    }))
    nonexistentButLoadedPage.load(undefined)

    function rel(target: string | undefined) {
      const t = expectValue(target, 'BUG')
      if (t.startsWith('https://')) { return t }
      return path.relative(manager.bundle.workspaceRootUri, t)
    }

    async function testPageLink(info: PageInfo, target: Opt<string>) {
      page.load(pageMaker(info))
      const links = await manager.getDocumentLinks(page)
      if (target === undefined) {
        expect(links).toEqual([])
      } else {
        expect(rel(links[0].target)).toBe(target)
      }
    }

    await testPageLink({ pageLinks: [{ url: 'https://openstax.org/somepage' }] }, 'https://openstax.org/somepage')
    // line number will change when pageMaker changes
    await testPageLink({ elementIds: ['my-el-id'], pageLinks: [{ targetId: 'my-el-id' }] }, 'modules/m00001/index.cnxml#9:0')
    await testPageLink({ pageLinks: [{ targetPage: 'm_doesnotexist' }] }, 'modules/m_doesnotexist/index.cnxml')
    await testPageLink({ pageLinks: [{ targetPage: otherId }] }, `modules/${otherId}/index.cnxml`)
    await testPageLink({ pageLinks: [{ targetPage: otherId, targetId: 'nonexistent-id' }] }, `modules/${otherId}/index.cnxml`)
    await testPageLink({ pageLinks: [{ targetPage: otherId, targetId: 'other-el-id' }] }, `modules/${otherId}/index.cnxml#9:0`)
    await testPageLink({ pageLinks: [{ targetPage: nonexistentButLoadedId }] }, undefined)
  })
})

describe('modifyToc()', () => {
  let manager = null as unknown as ModelManager
  let params = null as unknown as BooksAndOrphans
  beforeEach(() => {
    const bookSlug = 'slug2'
    const pageId = 'm1234'

    mockfs({
      'META-INF/books.xml': bundleMaker({ books: [bookSlug] }),
      'collections/slug2.collection.xml': bookMaker({ slug: bookSlug, toc: [{ title: 'subcollection', children: [pageId] }] }),
      'modules/m1234/index.cnxml': pageMaker({})
    })
    const bundle = new Bundle(FS_PATH_HELPER, process.cwd())
    manager = new ModelManager(bundle, conn, (p) => { params = p })
  })
  afterEach(() => mockfs.restore())

  function getInner(bookIndex: number) {
    const t1 = params.books[bookIndex].tocTree[0]
    if (t1.type === TocNodeKind.Inner) {
      return t1
    }
    throw new Error('BUG: Test expects first node in the ToC to be a Subbook')
  }
  function getLeaf(bookIndex: number) {
    for (const t1 of params.books[bookIndex].tocTree) {
      if (t1.type === TocNodeKind.Inner) {
        const t2 = t1.children[0]
        if (t2 !== undefined && t2.type === TocNodeKind.Leaf) {
          return t2
        }
      } else {
        return t1
      }
    }
    throw new Error('BUG: Test expects first node in the ToC to be a Subbook and its child to be a Page')
  }

  it('PageRename', async () => {
    const book = loadSuccess(first(loadSuccess(manager.bundle).books))
    const page = loadSuccess(first(book.pages))

    const bookIndex = 0
    const t = getLeaf(bookIndex)
    const nodeToken = t.value.token
    const newTitle = 'NEW_TITLE'

    const evt: TocModification = {
      type: TocModificationKind.PageRename,
      newTitle,
      nodeToken,
      bookIndex
    }

    await manager.modifyToc(evt)
    expect(page.optTitle).toBe(newTitle)
  })
  it('SubbookRename', async () => {
    const book = loadSuccess(first(loadSuccess(manager.bundle).books))

    const bookIndex = 0
    const t = getInner(bookIndex)
    const nodeToken = t.value.token
    const newTitle = 'NEW_TITLE'
    const evt: TocModification = {
      type: TocModificationKind.SubbookRename,
      newTitle,
      nodeToken,
      bookIndex
    }

    await manager.modifyToc(evt)
    const tocNode = book.toc[0]
    expect(tocNode.type === TocNodeKind.Inner && tocNode.title).toBe(newTitle)
  })
  it('Remove Subbook', async () => {
    const book = loadSuccess(first(loadSuccess(manager.bundle).books))

    const bookIndex = 0
    const t = getInner(bookIndex)
    const nodeToken = t.value.token
    const evt: TocModification = {
      type: TocModificationKind.Remove,
      nodeToken,
      bookIndex
    }

    await manager.modifyToc(evt)
    expect(book.toc).toEqual([])
  })
  it('Move to top and non-top', async () => {
    const book = loadSuccess(first(loadSuccess(manager.bundle).books))

    // BookToc starts off with just one subbook which contains one Page
    expect(book.toc[0].type).toBe(TocNodeKind.Inner)
    expect(book.toc.length).toBe(1)

    const bookIndex = 0
    let tLeaf = getLeaf(bookIndex)

    const evt1: TocModification = {
      type: TocModificationKind.Move,
      nodeToken: tLeaf.value.token,
      newParentToken: undefined,
      newChildIndex: 1,
      bookIndex
    }
    await manager.modifyToc(evt1)
    expect(book.toc[0].type).toBe(TocNodeKind.Inner)
    expect(book.toc[1].type).toBe(TocNodeKind.Leaf)

    // -------- Need to get new Tokens

    // Move the Page back under the Subbook
    const tInner = getInner(bookIndex)
    tLeaf = getLeaf(bookIndex)
    const evt2: TocModification = {
      type: TocModificationKind.Move,
      nodeToken: tLeaf.value.token,
      newParentToken: tInner.value.token,
      newChildIndex: 1,
      bookIndex
    }
    await manager.modifyToc(evt2)
    expect(book.toc[0].type).toBe(TocNodeKind.Inner)
    expect(book.toc.length).toBe(1)
  })
  it('creates a new Page in book', async () => {
    const book = loadSuccess(first(loadSuccess(manager.bundle).books))

    expect(book.pages.size).toBe(1)

    const bookIndex = 0
    const { page: loadedPage } = await manager.newPage(bookIndex, 'TEST_TITLE')

    expect(book.pages.size).toBe(2)
    expect(I.Set(book.pages).has(loadedPage)).toBe(true)
    expect(loadedPage.optTitle).toBe('TEST_TITLE')

    // Add another page for code coverage reasons
    await manager.newPage(bookIndex, 'TEST_TITLE2')
  })
  it('creates a new Subbook in book', async () => {
    const book = loadSuccess(first(loadSuccess(manager.bundle).books))

    expect(book.toc.length).toBe(1)

    const bookIndex = 0
    await manager.newSubbook(bookIndex, 'TEST_TITLE')

    expect(book.toc.length).toBe(2)
    expect(book.toc[0].type).toBe(TocNodeKind.Inner)
    const tocNode = book.toc[0]
    if (tocNode.type === TocNodeKind.Inner) {
      expect(tocNode.title).toBe('TEST_TITLE')
    } else throw new Error('BUG: unreachable case')
  })
})

// ------------ Stubs ------------
const emptyFn = <T = any>(): T => {
  function fn() {}
  return fn as unknown as T
} // jest.fn()
const WATCHDOG = new class StubWatchdog implements WatchDog {
  shutdownReceived = false
  initialize = emptyFn()
  exit = emptyFn()
  onClose = emptyFn()
  onError = emptyFn()
  write = emptyFn()
}()
function PROTOCOL_CONNECTION_FACTORY(logger: Logger): ProtocolConnection {
  return {
    onClose: emptyFn(),
    onRequest: emptyFn(),
    onNotification: emptyFn(),
    onProgress: emptyFn(),
    onError: emptyFn(),
    onUnhandledNotification: emptyFn(),
    onDispose: emptyFn(),
    sendRequest: emptyFn(),
    sendNotification: emptyFn(),
    sendProgress: emptyFn(),
    trace: emptyFn(),
    end: emptyFn(),
    dispose: emptyFn(),
    listen: emptyFn()
  }
}
PROTOCOL_CONNECTION_FACTORY.onClose = emptyFn()
PROTOCOL_CONNECTION_FACTORY.onError = emptyFn()
const conn = createConnection(PROTOCOL_CONNECTION_FACTORY, WATCHDOG)
