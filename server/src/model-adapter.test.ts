import SinonRoot from 'sinon'
import { createConnection, WatchDog } from 'vscode-languageserver'
import { Logger, ProtocolConnection, PublishDiagnosticsParams } from 'vscode-languageserver-protocol'
import { BookNode, PageNode } from './model'
import { BundleLoadManager, jobRunner, Job, pageAsTreeObject } from './model-adapter'
import { first, loadSuccess, makeBundle } from './model.test'

describe('Tree Translater', () => {
  let book = null as unknown as BookNode
  beforeEach(() => {
    book = loadSuccess(first(loadSuccess(makeBundle()).books()))
  })
  describe('pageAsTreeObject', () => {
    let page = null as unknown as PageNode
    beforeEach(() => {
      page = loadSuccess(first(book.pages()))
    })
    it('happy path', () => {
      const o = pageAsTreeObject(page)
      expect(o.moduleid).toEqual('m00001')
    })
  })
  it.skip('bookTocAsTreeCollection', () => {})
})

describe('Bundle Manager', () => {
  const sinon = SinonRoot.createSandbox()
  let manager = null as unknown as BundleLoadManager
  let sendDiagnosticsStub = null as unknown as SinonRoot.SinonStub<[params: PublishDiagnosticsParams], void>
  let enqueueStub = null as unknown as SinonRoot.SinonStub<[job: Job], void>

  beforeEach(() => {
    const bundle = makeBundle()
    const conn = createConnection(PROTOCOL_CONNECTION_FACTORY, WATCHDOG)
    manager = new BundleLoadManager(bundle, conn)
    sendDiagnosticsStub = sinon.stub(conn, 'sendDiagnostics')
    enqueueStub = sinon.stub(jobRunner, 'enqueue')
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
    loadSuccess(manager.bundle)
    manager.updateFileContents(manager.bundle.absPath, 'I am not XML so a Parse Error should be sent to diagnostics')
    expect(sendDiagnosticsStub.callCount).toBe(1)
    expect(enqueueStub.callCount).toBe(0)
  })
  it('loadEnoughForToc()', async () => {
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
  it('loadEnoughForOrphans()', async () => {
    expect(enqueueStub.callCount).toBe(0)
    await manager.loadEnoughForOrphans()
    expect(enqueueStub.callCount).toBe(4)
    console.warn('This test does not actually answer the question of "How many Orphans are there?"')
  })
  it.skip('processFilesystemChange()', async () => {})
  it.skip('performInitialValidation()', async () => {})
  it.skip('loadEnoughToSendDiagnostics()', async () => {})
})

describe('Job Runner', () => {
  it.skip('happy path', async () => {})
  it.skip('prioritizes fast jobs', async () => {})
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
