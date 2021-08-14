import mockfs from 'mock-fs'
import SinonRoot from 'sinon'
import { createConnection, WatchDog } from 'vscode-languageserver'
import { FileChangeType, Logger, ProtocolConnection, PublishDiagnosticsParams } from 'vscode-languageserver-protocol'
import { BookNode } from './model/book'
import { Bundle } from './model/bundle'
import { BundleLoadManager, jobRunner, Job, pageAsTreeObject, URIPair, bookTocAsTreeCollection } from './model-adapter'
import { first, FS_PATH_HELPER, loadSuccess, makeBundle } from './model/util.spec'

BundleLoadManager.debug = () => {} // Turn off logging

describe('Tree Translator', () => {
  let book = null as unknown as BookNode
  beforeEach(() => {
    book = loadSuccess(first(loadSuccess(makeBundle()).books()))
  })
  it('pageAsTreeObject', () => {
    const page = first(book.pages())
    expect(page.isLoaded()).toBe(false)
    const o = pageAsTreeObject(page)
    expect(o.moduleid).toEqual('m00001')
    expect(o.title).toBe('Introduction')
  })
  it('bookTocAsTreeCollection', () => {
    const o = bookTocAsTreeCollection(book)
    expect(o.slug).toBe('test')
    expect(o.title).toBe('test collection')
    expect(o.children.length).toBe(1)
  })
})

describe('Bundle Manager', () => {
  const sinon = SinonRoot.createSandbox()
  let manager = null as unknown as BundleLoadManager
  let sendDiagnosticsStub = null as unknown as SinonRoot.SinonStub<[params: PublishDiagnosticsParams], void>

  beforeEach(() => {
    const bundle = makeBundle()
    manager = new BundleLoadManager(bundle, conn)
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
    expect(manager.allPages().size).toBe(0)
    // Load the pages
    const book = loadSuccess(first(loadSuccess(manager.bundle).books()))
    loadSuccess(first(book.pages()))
    expect(manager.allPages().size).toBe(1)
  })
  it('orphanedPages()', () => {
    loadSuccess(first(loadSuccess(manager.bundle).books()))
    expect(manager.allPages().size).toBe(1)
    expect(manager.orhpanedPages().size).toBe(0)
    const orphanedPage = manager.bundle.allPages.get('path/to/orphaned/page')
    expect(manager.allPages().size).toBe(2)
    expect(manager.orhpanedPages().size).toBe(1)
    expect(manager.orhpanedPages().first()).toBe(orphanedPage)
  })
  it('updateFileContents()', () => {
    const enqueueStub = sinon.stub(jobRunner, 'enqueue')
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
    const enqueueStub = sinon.stub(jobRunner, 'enqueue')
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
    expect(manager.bundle.isLoaded()).toBe(false)
    manager.performInitialValidation()
    await jobRunner.done()

    expect(manager.bundle.allNodes().size).toBe(1 + 1 + 1) // bundle + book + page
    manager.bundle.allNodes().forEach(n => expect(n.isLoaded()).toBe(true))
  })
  it('loadEnoughToSendDiagnostics() sends diagnostics for a file we recognize', async () => {
    manager.loadEnoughToSendDiagnostics({
      workspace: manager.bundle.workspaceRoot,
      doc: manager.bundle.absPath
    })
    await jobRunner.done()

    expect(sendDiagnosticsStub.callCount).toBe(1)
    expect(manager.bundle.getValidationErrors().nodesToLoad.size).toBe(0)

    // Bundle needs to load all the books
    const books = manager.bundle.books()
    expect(books.size).toBe(1)
    books.forEach(b => expect(b.isLoaded()).toBe(true))
  })
  it('loadEnoughToSendDiagnostics() does not send diagnostics for a file we do not recognize', async () => {
    manager.loadEnoughToSendDiagnostics({
      workspace: manager.bundle.workspaceRoot,
      doc: '/path/t/non-existent/file'
    })
    await jobRunner.done()
    expect(sendDiagnosticsStub.callCount).toBe(0)
  })
})

describe('Find orphaned files', () => {
  const sinon = SinonRoot.createSandbox()
  beforeEach(() => {
    mockfs({
      'META-INF/books.xml': '<container xmlns="https://openstax.org/namespaces/book-container" version="1"/>',
      'modules/m2468/index.cnxml': 'this does-not-have-to-be-valid-XML-because-we-do-not-actually-parse-it-yet',
      'modules/m1357/index.cnxml': 'this does-not-have-to-be-valid-XML-because-we-do-not-actually-parse-it-yet'
    })
  })
  afterEach(() => {
    mockfs.restore()
    sinon.restore()
  })
  it('finds orphaned Pages', async () => {
    sinon.stub(conn, 'sendDiagnostics')
    const manager = new BundleLoadManager(new Bundle(FS_PATH_HELPER, process.cwd()), conn)
    await manager.loadEnoughForOrphans()
    await jobRunner.done()
    expect(manager.orhpanedPages().size).toBe(2)
  })
})

describe('processFilesystemChange()', () => {
  const sinon = SinonRoot.createSandbox()
  let manager = null as unknown as BundleLoadManager
  let sendDiagnosticsStub = null as unknown as SinonRoot.SinonStub<[params: PublishDiagnosticsParams], void>
  let enqueueStub = null as unknown as SinonRoot.SinonStub<[job: Job], void>

  async function fireChange(type: FileChangeType, filePath: string) {
    const rootUri = FS_PATH_HELPER.join(FS_PATH_HELPER.dirname(manager.bundle.absPath), '..')
    return await manager.processFilesystemChange({ type, uri: FS_PATH_HELPER.join(rootUri, filePath) })
  }

  beforeEach(() => {
    mockfs({
      'META-INF/books.xml': `<container xmlns="https://openstax.org/namespaces/book-container" version="1">
                                <book slug="slug1" href="../collections/slug2.collection.xml" />
                            </container>`,
      'collections/slug2.collection.xml': `<col:collection xmlns:col="http://cnx.rice.edu/collxml" xmlns:md="http://cnx.rice.edu/mdml" xmlns="http://cnx.rice.edu/collxml">
                              <col:metadata>
                                <md:title>test collection</md:title>
                                <md:slug>test1</md:slug>
                              </col:metadata>
                              <col:content>
                                <col:subcollection>
                                  <md:title>subcollection</md:title>
                                  <col:content>
                                    <col:module document="m1234" />
                                  </col:content>
                                </col:subcollection>
                              </col:content>
                            </col:collection>`,
      'modules/m1234/index.cnxml': `<document xmlns="http://cnx.rice.edu/cnxml">
                        <title>Module Title</title>
                        <metadata xmlns:md="http://cnx.rice.edu/mdml">
                          <md:uuid>00000000-0000-4000-0000-000000000000</md:uuid>
                        </metadata>
                        <content/>
                      </document>`
    })
    const bundle = new Bundle(FS_PATH_HELPER, process.cwd())
    manager = new BundleLoadManager(bundle, conn)
    sendDiagnosticsStub = sinon.stub(conn, 'sendDiagnostics')
    enqueueStub = sinon.stub(jobRunner, 'enqueue')
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
    expect(manager.bundle.isLoaded()).toBe(false)
    expect((await fireChange(FileChangeType.Created, 'META-INF/books.xml')).size).toBe(1)
    expect(manager.bundle.isLoaded()).toBe(true)

    expect((await fireChange(FileChangeType.Created, 'collections/slug2.collection.xml')).size).toBe(1)
    expect((await fireChange(FileChangeType.Created, 'modules/m1234/index.cnxml')).size).toBe(1)
    expect((await fireChange(FileChangeType.Created, 'media/newpic.png')).size).toBe(1)
  })
  it('does not create things it does not understand', async () => {
    expect((await fireChange(FileChangeType.Created, 'README.md')).size).toBe(0)
  })
  it('updates Images/Pages/Books', async () => {
    expect((await fireChange(FileChangeType.Changed, 'META-INF/books.xml')).size).toBe(1)
    expect(sendDiagnosticsStub.callCount).toBe(0)
    expect(enqueueStub.callCount).toBe(2) // There is one book and 1 re-enqueue

    expect((await fireChange(FileChangeType.Changed, 'collections/slug2.collection.xml')).size).toBe(1)
    expect(sendDiagnosticsStub.callCount).toBe(0)

    expect((await fireChange(FileChangeType.Changed, 'modules/m1234/index.cnxml')).size).toBe(1)
    expect(sendDiagnosticsStub.callCount).toBe(1)

    expect((await fireChange(FileChangeType.Changed, 'media/newpic.png')).size).toBe(0) // Since the model was not aware of the file yet
  })
  it('deletes Files and directories', async () => {
    // Load the Bundle, Book, and Page
    loadSuccess(first(loadSuccess(first(loadSuccess(manager.bundle).books())).pages()))

    // Delete non-existent file
    expect((await fireChange(FileChangeType.Deleted, 'media/newpic.png')).size).toBe(0)
    // Delete a file
    expect((await fireChange(FileChangeType.Deleted, 'modules/m1234/index.cnxml')).size).toBe(1)
    // Delete a directory
    expect((await fireChange(FileChangeType.Deleted, 'collections')).size).toBe(1)
    expect(sendDiagnosticsStub.callCount).toBe(0)

    // Delete everything (including the bundle)
    expect((await fireChange(FileChangeType.Deleted, '')).size).toBe(1)
    expect(manager.bundle.exists()).toBe(false)
  })
  it('deletes Image/Page/Book', async () => {
    // Load the Bundle, Book, and Page
    const bundle = loadSuccess(manager.bundle)
    const book = loadSuccess(first(bundle.books()))
    const page = loadSuccess(first(book.pages()))

    expect((await fireChange(FileChangeType.Deleted, book.filePath())).size).toBe(1)
    expect((await fireChange(FileChangeType.Deleted, page.filePath())).size).toBe(1)
    expect((await fireChange(FileChangeType.Deleted, bundle.filePath())).size).toBe(1)
  })
})

describe('Job Runner', () => {
  const context: URIPair = { workspace: 'aaa', doc: 'bbb' }
  it('runs newly added jobs first (stack)', async () => {
    const appendLog: string[] = []
    jobRunner.enqueue({ type: 'testcheck', context, fn: () => appendLog.push('Job1') })
    jobRunner.enqueue({ type: 'testcheck', context, fn: () => appendLog.push('Job2') })
    jobRunner.enqueue({ type: 'testcheck', context, fn: () => appendLog.push('Job3') })
    jobRunner.enqueue({ type: 'testcheck', context, fn: () => appendLog.push('Job4') })
    jobRunner.enqueue({ type: 'testcheck', context, fn: () => appendLog.push('Job5') })
    expect(appendLog).toEqual([]) // Nothing immediately executes (otherwise jobs would keep restacking themselves)
    await jobRunner.done()
    expect(appendLog).toEqual(['Job5', 'Job4', 'Job3', 'Job2', 'Job1'])
  })
  it('prioritizes fast jobs', async () => {
    const appendLog: string[] = []
    jobRunner.enqueue({ type: 'testcheck', context, fn: () => appendLog.push('Initial') })
    jobRunner.enqueue({ type: 'testcheck', context, fn: () => appendLog.push('Fast1') })
    jobRunner.enqueue({ type: 'testcheck', context, fn: () => appendLog.push('Slow1'), slow: true })
    jobRunner.enqueue({ type: 'testcheck', context, fn: () => appendLog.push('Fast2') })
    jobRunner.enqueue({ type: 'testcheck', context, fn: () => appendLog.push('Slow2'), slow: true })
    expect(appendLog).toEqual([])
    await jobRunner.done()
    expect(appendLog).toEqual(['Fast2', 'Fast1', 'Initial', 'Slow2', 'Slow1'])
  })
  it('done() waits even when there are no jobs running', async () => {
    await jobRunner.done()
  })
})

// ------------ Stubs ------------
const WATCHDOG = new class StubWatchdog implements WatchDog {
  shutdownReceived = false
  initialize = jest.fn()
  exit = jest.fn()
  onClose = jest.fn()
  onError = jest.fn()
}()
function PROTOCOL_CONNECTION_FACTORY(logger: Logger): ProtocolConnection {
  return {
    onClose: jest.fn(),
    onRequest: jest.fn(),
    onNotification: jest.fn(),
    onProgress: jest.fn(),
    onError: jest.fn(),
    onUnhandledNotification: jest.fn(),
    onDispose: jest.fn(),
    sendRequest: jest.fn(),
    sendNotification: jest.fn(),
    sendProgress: jest.fn(),
    trace: jest.fn(),
    end: jest.fn(),
    dispose: jest.fn(),
    listen: jest.fn()
  }
}
PROTOCOL_CONNECTION_FACTORY.onClose = jest.fn()
PROTOCOL_CONNECTION_FACTORY.onError = jest.fn()
const conn = createConnection(PROTOCOL_CONNECTION_FACTORY, WATCHDOG)
