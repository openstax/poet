import assert from 'assert'
import fs from 'fs-extra'
import path from 'path'
import vscode from 'vscode'
import SinonRoot from 'sinon'
import 'source-map-support/register'
import { expect as expectOrig, getRootPathUri } from './../../utils'
import { forwardOnDidChangeWorkspaceFolders } from './../../extension'
import { CnxmlPreviewPanel, rawTextHtml } from './../../panel-cnxml-preview'
import { Suite } from 'mocha'
import { LanguageClient } from 'vscode-languageclient/node'
import { EMPTY_BOOKS_AND_ORPHANS } from '../../../../common/src/requests'
import { Disposer, ExtensionEvents, ExtensionHostContext, Panel } from '../../panel'

const ROOT_DIR_REL = '../../../../../../'
const ROOT_DIR_ABS = path.resolve(__dirname, ROOT_DIR_REL)

// Test runs in out/client/src/test/suite, not src/client/src/test/suite
const ORIGIN_DATA_DIR = ROOT_DIR_ABS
const TEST_DATA_DIR = path.join(__dirname, '../data/test-repo')
const TEST_OUT_DIR = path.join(__dirname, '../../')

const resourceRootDir = TEST_OUT_DIR
const createMockClient = (): LanguageClient => {
  return {
    sendRequest: SinonRoot.stub().returns([]),
    onRequest: SinonRoot.stub().returns({ dispose: () => { } })
  } as unknown as LanguageClient
}

type ExtractEventGeneric<GenericEvent> = GenericEvent extends vscode.Event<infer X> ? X : never
type ExtensionEventEmitters = { [key in keyof ExtensionEvents]: vscode.EventEmitter<ExtractEventGeneric<ExtensionEvents[key]>> }
const createMockEvents = (): { emitters: ExtensionEventEmitters, events: ExtensionEvents } => {
  const onDidChangeWatchedFilesEmitter: vscode.EventEmitter<undefined> = new vscode.EventEmitter()
  const emitters = {
    onDidChangeWatchedFiles: onDidChangeWatchedFilesEmitter
  }
  const events = {
    onDidChangeWatchedFiles: onDidChangeWatchedFilesEmitter.event
  }
  return { emitters, events }
}

async function sleep(ms: number): Promise<void> {
  return await new Promise(resolve => setTimeout(resolve, ms))
}

function expect<T>(value: T | null | undefined): T {
  return expectOrig(value, 'test_assertion')
}

async function replaceUriDocumentContent(uri: vscode.Uri, content: string): Promise<void> {
  const document = await vscode.workspace.openTextDocument(uri)
  const fullRange = new vscode.Range(
    document.positionAt(0),
    document.positionAt(document.getText().length)
  )
  const edit = new vscode.WorkspaceEdit()
  edit.replace(uri, fullRange, content)
  await vscode.workspace.applyEdit(edit)
  await document.save()
}

const resetTestData = async (): Promise<void> => {
  await vscode.workspace.saveAll(true)
  for (const subdir of ['META-INF', 'collections', 'media', 'modules']) {
    fs.rmdirSync(path.join(TEST_DATA_DIR, subdir), { recursive: true })
    fs.copySync(path.join(ORIGIN_DATA_DIR, subdir), path.join(TEST_DATA_DIR, subdir))
  }
  fs.rmdirSync(path.join(TEST_DATA_DIR, '.xsd'), { recursive: true })
  await vscode.commands.executeCommand('workbench.action.closeAllEditors')
}

suite('Extension Test Suite', function (this: Suite) {
  const sinon = SinonRoot.createSandbox()

  this.beforeAll(async () => {
    await resetTestData()
  })

  this.beforeEach(() => {
    sinon.spy(CnxmlPreviewPanel.prototype, 'postMessage')
  })

  this.afterEach(async () => {
    await resetTestData()
    sinon.restore()
    sinon.reset()
    sinon.resetBehavior()
    sinon.resetHistory()
  })

  test('cnxml preview refreshes when server watched file changes', async () => {
    const uri = expect(getRootPathUri())
    const mockEvents = createMockEvents()
    const watchedFilesSpy = sinon.spy(mockEvents.events, 'onDidChangeWatchedFiles')
    const resource = uri.with({ path: path.join(uri.path, 'modules', 'm00001', 'index.cnxml') })
    const panel = new CnxmlPreviewPanel({ bookTocs: EMPTY_BOOKS_AND_ORPHANS, resourceRootDir, client: createMockClient(), events: mockEvents.events })
    await sleep(100) // FIXME: Make me go away (see https://github.com/openstax/cnx/issues/1569)
    const rebindingStub = sinon.spy(panel as any, 'rebindToResource')
    const panelBindingChanged = new Promise((resolve, reject) => {
      panel.onDidChangeResourceBinding((event) => {
        if (event != null && event.fsPath === resource.fsPath) {
          resolve(event)
        }
      })
    })
    const document = await vscode.workspace.openTextDocument(resource)
    await vscode.window.showTextDocument(document, vscode.ViewColumn.Two)
    await panelBindingChanged
    const refreshCount = rebindingStub.callCount
    await watchedFilesSpy.getCall(0).args[0]()
    assert.strictEqual(rebindingStub.callCount, refreshCount + 1)
  })
  test('cnxml preview throws upon unexpected message', async () => {
    const panel = new CnxmlPreviewPanel({ bookTocs: EMPTY_BOOKS_AND_ORPHANS, resourceRootDir, client: createMockClient(), events: createMockEvents().events })
    await assert.rejects(panel.handleMessage({ type: 'bad-type' } as any))
  })
  test('forwardOnDidChangeWorkspaceFolders simply forwards any argument to client', async () => {
    const mockClient = createMockClient()
    const forwarder = forwardOnDidChangeWorkspaceFolders(mockClient)
    await forwarder('test_event' as unknown as vscode.WorkspaceFoldersChangeEvent)
    const expected = ['onDidChangeWorkspaceFolders', 'test_event']
    assert((mockClient.sendRequest as SinonRoot.SinonStub).calledOnceWith(...expected))
  })
})

suite('Disposables', function (this: Suite) {
  const sinon = SinonRoot.createSandbox()
  const initTestPanel = (_context: ExtensionHostContext): vscode.WebviewPanel => {
    const panel = vscode.window.createWebviewPanel(
      'openstax.testPanel',
      'Test Panel',
      vscode.ViewColumn.One
    )
    panel.webview.html = rawTextHtml('test')
    return panel
  }
  class TestPanel extends Panel<void, void, null> {
    constructor(private readonly context: ExtensionHostContext) {
      super(initTestPanel(context))
    }

    protected getState() { return null }

    async handleMessage(_message: undefined): Promise<void> {
      throw new Error('Method not implemented.')
    }
  }
  this.afterEach(async () => {
    sinon.restore()
    sinon.reset()
    sinon.resetBehavior()
    sinon.resetHistory()
  })

  test('onDidDispose event run upon disposal', async () => {
    const panel = new TestPanel({ bookTocs: EMPTY_BOOKS_AND_ORPHANS, resourceRootDir, client: createMockClient(), events: createMockEvents().events })
    const panelDisposed = new Promise((resolve, reject) => {
      panel.onDidDispose(() => {
        resolve(true)
      })
    })
    panel.dispose()
    assert(await panelDisposed)
  })
  test('disposed panels may not post messages', async () => {
    const panel = new TestPanel({ bookTocs: EMPTY_BOOKS_AND_ORPHANS, resourceRootDir, client: createMockClient(), events: createMockEvents().events })
    const postStub = sinon.stub((panel as any).panel.webview, 'postMessage').rejects()
    panel.dispose()
    await panel.postMessage(undefined)
    assert(postStub.notCalled)
  })
  test('registered disposables disposed upon parent disposal', async () => {
    const panel = new TestPanel({ bookTocs: EMPTY_BOOKS_AND_ORPHANS, resourceRootDir, client: createMockClient(), events: createMockEvents().events })
    const testDisposable = new Disposer()
    panel.registerDisposable(testDisposable)
    const childDisposed = new Promise((resolve, reject) => {
      testDisposable.onDidDispose(() => {
        resolve(true)
      })
    })
    panel.dispose()
    assert(await childDisposed)
  })
  test('registered disposables disposed immediately if parent disposed', async () => {
    const panel = new TestPanel({ bookTocs: EMPTY_BOOKS_AND_ORPHANS, resourceRootDir, client: createMockClient(), events: createMockEvents().events })
    panel.dispose()
    const testDisposable = new Disposer()
    const childDisposed = new Promise((resolve, reject) => {
      testDisposable.onDidDispose(() => {
        resolve(true)
      })
    })
    panel.registerDisposable(testDisposable)
    assert(await childDisposed)
  })
})
