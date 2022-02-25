import assert from 'assert'
import fs from 'fs-extra'
import path from 'path'
import vscode from 'vscode'
import SinonRoot from 'sinon'
import { GitErrorCodes, Repository, CommitOptions, RepositoryState, Branch, RefType } from '../../git-api/git.d'
import 'source-map-support/register'
import { expect as expectOrig, getRootPathUri } from './../../utils'
import { activate, deactivate, forwardOnDidChangeWorkspaceFolders } from './../../extension'
import { ImageManagerPanel } from './../../panel-image-manager'
import { CnxmlPreviewPanel, rawTextHtml, tagElementsWithLineNumbers } from './../../panel-cnxml-preview'
import { OpenstaxCommand } from '../../extension-types'
import * as pushContent from '../../push-content'
import { Suite } from 'mocha'
import { DOMParser, XMLSerializer } from 'xmldom'
import { Substitute } from '@fluffy-spoon/substitute'
import { LanguageClient } from 'vscode-languageclient/node'
import { EMPTY_BOOKS_AND_ORPHANS, DiagnosticSource, ExtensionServerRequest } from '../../../../common/src/requests'
import { PanelStateMessageType } from '../../../../common/src/webview-constants'
import { Disposer, ExtensionEvents, ExtensionHostContext, Panel } from '../../panel'

const ROOT_DIR_REL = '../../../../../../'
const ROOT_DIR_ABS = path.resolve(__dirname, ROOT_DIR_REL)

// Test runs in out/client/src/test/suite, not src/client/src/test/suite
const ORIGIN_DATA_DIR = ROOT_DIR_ABS
const TEST_DATA_DIR = path.join(__dirname, '../data/test-repo')
const TEST_OUT_DIR = path.join(__dirname, '../../')

const contextStub = {
  asAbsolutePath: (relPath: string) => path.resolve(ROOT_DIR_ABS, relPath)
}
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

const fakeXmlExtension: vscode.Extension<any> = {
  activate: SinonRoot.stub().resolves({
    addXMLCatalogs: (catalogs: string[]): void => {}
  })
} as any as vscode.Extension<any>

// Stub the XML extension temporarily for this test helper setup so activate()
// doesn't error
SinonRoot.stub(vscode.extensions, 'getExtension').withArgs('redhat.vscode-xml').returns(fakeXmlExtension)
const extensionExports = activate(contextStub as any)
SinonRoot.restore()

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

const withPanelFromCommand = async (command: OpenstaxCommand, func: (arg0: vscode.WebviewPanel) => Promise<void>): Promise<void> => {
  await vscode.commands.executeCommand(command)
  // Wait for panel to load
  await sleep(1000)
  const panelManager = expect((await extensionExports)[command])
  const panel = expect(panelManager.panel())
  await func((panel as any).panel)
  panel.dispose()
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
    sinon.stub(vscode.extensions, 'getExtension').withArgs('redhat.vscode-xml').returns(fakeXmlExtension)
  })

  this.afterEach(async () => {
    await resetTestData()
    sinon.restore()
    sinon.reset()
    sinon.resetBehavior()
    sinon.resetHistory()
  })

  test('getRootPathUri', () => {
    const uri = expect(getRootPathUri())
    assert.strictEqual(uri.fsPath, TEST_DATA_DIR)
    /*
     * Can't test null case, due to some issues with VSCode
     * reloading extensions when the root workspace is removed
     * even if it is re-added. Here is the rest of this test:
     *
     * vscode.workspace.updateWorkspaceFolders(0, 1)
     * const uriNull = getRootPathUri()
     * assert.strictEqual(uriNull, null)
     * // Add the original workspace folder back
     * vscode.workspace.updateWorkspaceFolders(0, 0, { uri: expect(uri) })
     * const uriAgain = expect(getRootPathUri())
     * assert.strictEqual(uriAgain.fsPath, TEST_DATA_DIR)
     */
  })
  // test('show toc editor', async () => {
  //   await withPanelFromCommand(OpenstaxCommand.SHOW_TOC_EDITOR, async (panel) => {
  //     const html = panel.webview.html
  //     assert.notStrictEqual(html, null)
  //     assert.notStrictEqual(html, undefined)
  //     assert.notStrictEqual(html.indexOf('html'), -1)
  //   })
  // }).timeout(5000)

  // TODO: image upload test is commented because image upload UX is not finished.
  // test('show image upload', async () => {
  //   await withPanelFromCommand(OpenstaxCommand.SHOW_IMAGE_MANAGER, async (panel) => {
  //     const html = panel.webview.html
  //     assert.notStrictEqual(html, null)
  //     assert.notStrictEqual(html, undefined)
  //     assert.notStrictEqual(html.indexOf('html'), -1)
  //   })
  // }).timeout(5000)
  test('image upload handle message', async () => {
    const data = fs.readFileSync(path.join(TEST_DATA_DIR, 'media/urgent.jpg'), { encoding: 'base64' })
    const panel = new ImageManagerPanel({ bookTocs: EMPTY_BOOKS_AND_ORPHANS, resourceRootDir, client: createMockClient(), events: createMockEvents().events })
    await panel.handleMessage({ mediaUploads: [{ mediaName: 'urgent2.jpg', data: 'data:image/jpeg;base64,' + data }] })
    const uploaded = fs.readFileSync(path.join(TEST_DATA_DIR, 'media/urgent2.jpg'), { encoding: 'base64' })
    assert.strictEqual(data, uploaded)
  })
  test('image upload handle message ignore duplicate image', async () => {
    const data = fs.readFileSync(path.join(TEST_DATA_DIR, 'media/urgent.jpg'), { encoding: 'base64' })
    const panel = new ImageManagerPanel({ bookTocs: EMPTY_BOOKS_AND_ORPHANS, resourceRootDir, client: createMockClient(), events: createMockEvents().events })
    await panel.handleMessage({ mediaUploads: [{ mediaName: 'urgent.jpg', data: 'data:image/jpeg;base64,0' }] })
    const newData = fs.readFileSync(path.join(TEST_DATA_DIR, 'media/urgent.jpg'), { encoding: 'base64' })
    assert.strictEqual(data, newData)
  })
  test('show cnxml preview with no file open', async () => {
    assert.strictEqual(vscode.window.activeTextEditor, undefined)
    await sleep(500) // FIXME: Make me go away (see https://github.com/openstax/cnx/issues/1569)
    await withPanelFromCommand(OpenstaxCommand.SHOW_CNXML_PREVIEW, async (panel) => {
      assert(panel.webview.html.includes('No resource available to preview'))
    })
  }).timeout(5000)
  test('show cnxml preview with a file open', async () => {
    const uri = expect(getRootPathUri())
    const resource = uri.with({ path: path.join(uri.path, 'modules', 'm00001', 'index.cnxml') })
    const document = await vscode.workspace.openTextDocument(resource)
    await vscode.window.showTextDocument(document)
    await withPanelFromCommand(OpenstaxCommand.SHOW_CNXML_PREVIEW, async (panel) => {
      const html = panel.webview.html
      assert.notStrictEqual(html, null)
      assert.notStrictEqual(html, undefined)
      assert.notStrictEqual(html.indexOf('html'), -1)
    })
  }).timeout(5000)
  test('cnxml preview rebinds to resource in the active editor', async () => {
    const uri = expect(getRootPathUri())
    const panel = new CnxmlPreviewPanel({ bookTocs: EMPTY_BOOKS_AND_ORPHANS, resourceRootDir, client: createMockClient(), events: createMockEvents().events })
    await sleep(100) // FIXME: Make me go away (see https://github.com/openstax/cnx/issues/1569)
    assert.strictEqual((panel as any).resourceBinding, null)

    const resourceFirst = uri.with({ path: path.join(uri.path, 'modules', 'm00001', 'index.cnxml') })
    const resourceBindingChangedExpectedFirst: Promise<vscode.Uri | null> = new Promise((resolve, reject) => {
      panel.onDidChangeResourceBinding((event) => {
        if (event != null && event.fsPath === resourceFirst.fsPath) {
          resolve(event)
        }
      })
    })
    const resourceSecond = uri.with({ path: path.join(uri.path, 'modules', 'm00002', 'index.cnxml') })
    const resourceBindingChangedExpectedSecond: Promise<vscode.Uri | null> = new Promise((resolve, reject) => {
      panel.onDidChangeResourceBinding((event) => {
        if (event != null && event.fsPath === resourceSecond.fsPath) {
          resolve(event)
        }
      })
    })

    const documentFirst = await vscode.workspace.openTextDocument(resourceFirst)
    await vscode.window.showTextDocument(documentFirst, vscode.ViewColumn.Two)
    const contentFromFsBecauseVscodeLiesAboutDocumentContentFirst = await fs.promises.readFile(resourceFirst.fsPath, { encoding: 'utf-8' })
    const documentDomFirst = new DOMParser().parseFromString(contentFromFsBecauseVscodeLiesAboutDocumentContentFirst)
    tagElementsWithLineNumbers(documentDomFirst)
    const xmlExpectedFirst = new XMLSerializer().serializeToString(documentDomFirst)
    await resourceBindingChangedExpectedFirst
    assert((panel as any).panel.webview.html.includes(JSON.stringify(xmlExpectedFirst)))
    assert.strictEqual((panel as any).resourceBinding.fsPath, resourceFirst.fsPath)

    const documentSecond = await vscode.workspace.openTextDocument(resourceSecond)
    await vscode.window.showTextDocument(documentSecond, vscode.ViewColumn.Two)
    const contentFromFsBecauseVscodeLiesAboutDocumentContentSecond = await fs.promises.readFile(resourceSecond.fsPath, { encoding: 'utf-8' })
    const documentDomSecond = new DOMParser().parseFromString(contentFromFsBecauseVscodeLiesAboutDocumentContentSecond)
    tagElementsWithLineNumbers(documentDomSecond)
    const xmlExpectedSecond = new XMLSerializer().serializeToString(documentDomSecond)
    await resourceBindingChangedExpectedSecond
    const xsl = await fs.promises.readFile(
      path.join(resourceRootDir, 'cnxml-to-html5.xsl'),
      'utf-8'
    )
    assert((panel.postMessage as SinonRoot.SinonSpy).calledWith({ type: PanelStateMessageType.Response, state: { xml: xmlExpectedSecond, xsl: xsl } }))
    assert.strictEqual((panel as any).resourceBinding.fsPath, resourceSecond.fsPath)
  }).timeout(5000)
  test('cnxml preview only rebinds to cnxml', async () => {
    const uri = expect(getRootPathUri())
    const panel = new CnxmlPreviewPanel({ bookTocs: EMPTY_BOOKS_AND_ORPHANS, resourceRootDir, client: createMockClient(), events: createMockEvents().events })
    await sleep(100) // FIXME: Make me go away (see https://github.com/openstax/cnx/issues/1569)

    const resourceFirst = uri.with({ path: path.join(uri.path, 'modules', 'm00001', 'index.cnxml') })
    const resourceBindingChangedExpectedFirst: Promise<vscode.Uri | null> = new Promise((resolve, reject) => {
      panel.onDidChangeResourceBinding((event) => {
        if (event != null && event.fsPath === resourceFirst.fsPath) {
          resolve(event)
        }
      })
    })

    const documentFirst = await vscode.workspace.openTextDocument(resourceFirst)
    await vscode.window.showTextDocument(documentFirst, vscode.ViewColumn.Two)
    const documentDomFirst = new DOMParser().parseFromString(documentFirst.getText())
    tagElementsWithLineNumbers(documentDomFirst)
    const xmlExpectedFirst = new XMLSerializer().serializeToString(documentDomFirst)
    await resourceBindingChangedExpectedFirst

    const resourceSecond = uri.with({ path: path.join(uri.path, 'collections', 'test.collection.xml') })
    const documentSecond = await vscode.workspace.openTextDocument(resourceSecond)
    await vscode.window.showTextDocument(documentSecond, vscode.ViewColumn.Two)

    const resourceThird = uri.with({ path: path.join(uri.path, 'media', 'README.md') })
    const documentThird = await vscode.workspace.openTextDocument(resourceThird)
    await vscode.window.showTextDocument(documentThird, vscode.ViewColumn.Two)

    assert((panel as any).panel.webview.html.includes(JSON.stringify(xmlExpectedFirst)))
    const refreshCalls = (panel.postMessage as SinonRoot.SinonSpy)
      .getCalls()
      .filter(call => call.args.some(arg => arg.type != null && arg.type === 'refresh'))
    assert.strictEqual(refreshCalls.length, 0)
    assert.strictEqual((panel as any).resourceBinding.fsPath, resourceFirst.fsPath)
  })
  test('cnxml preview refuses refresh if no resource bound', async () => {
    const panel = new CnxmlPreviewPanel({ bookTocs: EMPTY_BOOKS_AND_ORPHANS, resourceRootDir, client: createMockClient(), events: createMockEvents().events })
    assert(panel.isPreviewOf(null))
    await (panel as any).tryRebindToResource(null)
    await (panel as any).rebindToResource(null)
    const refreshCalls = (panel.postMessage as SinonRoot.SinonSpy)
      .getCalls()
      .filter(call => call.args.some(arg => arg.type != null && arg.type === 'refresh'))
    assert.strictEqual(refreshCalls.length, 0)
  })
  test('cnxml preview messaged upon visible range change', async () => {
    const uri = expect(getRootPathUri())

    // An editor not bound to the panel
    const resourceIrrelevant = uri.with({ path: path.join(uri.path, 'modules', 'm00002', 'index.cnxml') })
    const documentIrrelevant = await vscode.workspace.openTextDocument(resourceIrrelevant)
    const unboundEditor = await vscode.window.showTextDocument(documentIrrelevant, vscode.ViewColumn.One)

    // The editor we are bound to
    const resource = uri.with({ path: path.join(uri.path, 'modules', 'm00001', 'index.cnxml') })
    const document = await vscode.workspace.openTextDocument(resource)
    const boundEditor = await vscode.window.showTextDocument(document, vscode.ViewColumn.Two)

    // We need something long enough to scroll in
    const testData = `<document><pre>${'\n'.repeat(100)}</pre>Test<pre>${'\n'.repeat(100)}</pre></document>`
    const panel = new CnxmlPreviewPanel({ bookTocs: EMPTY_BOOKS_AND_ORPHANS, resourceRootDir, client: createMockClient(), events: createMockEvents().events })
    const resourceBindingChanged: Promise<vscode.Uri | null> = new Promise((resolve, reject) => {
      panel.onDidChangeResourceBinding((event) => {
        if (event != null && event.fsPath === resource.fsPath) {
          resolve(event)
        }
      })
    })
    await resourceBindingChanged

    // reset revealed range
    const visualRangeResetBound = new Promise((resolve, reject) => {
      vscode.window.onDidChangeTextEditorVisibleRanges((event) => { if (event.textEditor === boundEditor) { resolve(undefined) } })
    })
    const visualRangeResetUnbound = new Promise((resolve, reject) => {
      vscode.window.onDidChangeTextEditorVisibleRanges((event) => { if (event.textEditor === unboundEditor) { resolve(undefined) } })
    })
    const resetRange = new vscode.Range(0, 0, 1, 0)
    const resetStrategy = vscode.TextEditorRevealType.AtTop
    boundEditor.revealRange(resetRange, resetStrategy)
    unboundEditor.revealRange(resetRange, resetStrategy)
    // Promise.race in case the visual range was already correct
    await Promise.race([Promise.all([visualRangeResetBound, visualRangeResetUnbound]), sleep(500)])

    await replaceUriDocumentContent(resource, testData)
    await replaceUriDocumentContent(resourceIrrelevant, testData)

    const range = new vscode.Range(100, 0, 101, 0)
    const strategy = vscode.TextEditorRevealType.AtTop

    const visualRangeChangedFirst = new Promise((resolve, reject) => {
      vscode.window.onDidChangeTextEditorVisibleRanges(() => { resolve(undefined) })
    })
    unboundEditor.revealRange(range, strategy)
    await visualRangeChangedFirst
    assert(!(panel.postMessage as SinonRoot.SinonSpy).calledWith({ type: 'scroll-in-preview', line: 100 }))
    assert(!(panel.postMessage as SinonRoot.SinonSpy).calledWith({ type: 'scroll-in-preview', line: 101 }))

    const visualRangeChangedSecond = new Promise((resolve, reject) => {
      vscode.window.onDidChangeTextEditorVisibleRanges(() => { resolve(undefined) })
    })
    boundEditor.revealRange(range, strategy)
    await visualRangeChangedSecond
    assert((panel.postMessage as SinonRoot.SinonSpy).calledWith({ type: 'scroll-in-preview', line: 101 }))
  })
  test('cnxml preview scroll sync in editor updates visible range', async () => {
    const uri = expect(getRootPathUri())

    // An editor we should not scroll in
    const resourceIrrelevant = uri.with({ path: path.join(uri.path, 'modules', 'm00002', 'index.cnxml') })
    const documentIrrelevant = await vscode.workspace.openTextDocument(resourceIrrelevant)
    const unboundEditor = await vscode.window.showTextDocument(documentIrrelevant, vscode.ViewColumn.One)

    // The actual editor we are scrolling in
    const resource = uri.with({ path: path.join(uri.path, 'modules', 'm00001', 'index.cnxml') })
    const document = await vscode.workspace.openTextDocument(resource)
    const boundEditor = await vscode.window.showTextDocument(document, vscode.ViewColumn.Two)

    // We need something long enough to scroll to
    const testData = `<document><pre>${'\n'.repeat(100)}</pre>Test<pre>${'\n'.repeat(100)}</pre></document>`
    const panel = new CnxmlPreviewPanel({ bookTocs: EMPTY_BOOKS_AND_ORPHANS, resourceRootDir, client: createMockClient(), events: createMockEvents().events })
    const resourceBindingChanged: Promise<vscode.Uri | null> = new Promise((resolve, reject) => {
      panel.onDidChangeResourceBinding((event) => {
        if (event != null && event.fsPath === resource.fsPath) {
          resolve(event)
        }
      })
    })
    await resourceBindingChanged

    // reset revealed range
    const visualRangeResetBound = new Promise((resolve, reject) => {
      vscode.window.onDidChangeTextEditorVisibleRanges((event) => { if (event.textEditor === boundEditor) { resolve(undefined) } })
    })
    const visualRangeResetUnbound = new Promise((resolve, reject) => {
      vscode.window.onDidChangeTextEditorVisibleRanges((event) => { if (event.textEditor === unboundEditor) { resolve(undefined) } })
    })
    const range = new vscode.Range(0, 0, 1, 0)
    const strategy = vscode.TextEditorRevealType.AtTop
    boundEditor.revealRange(range, strategy)
    unboundEditor.revealRange(range, strategy)
    // Promise.race in case the visual range was already correct
    await Promise.race([Promise.all([visualRangeResetBound, visualRangeResetUnbound]), sleep(500)])

    await replaceUriDocumentContent(resource, testData)
    await replaceUriDocumentContent(resourceIrrelevant, testData);

    // ensure scrollable
    (panel as any).resourceIsScrolling = false
    const visualRangeChanged = new Promise((resolve, reject) => {
      vscode.window.onDidChangeTextEditorVisibleRanges(() => { resolve(undefined) })
    })
    await panel.handleMessage({ type: 'scroll-in-editor', line: 101 })
    await Promise.race([visualRangeChanged, sleep(500)])

    const firstVisiblePosition = boundEditor.visibleRanges[0].start
    const lineNumber = firstVisiblePosition.line
    assert.strictEqual((panel as any).resourceBinding.fsPath, resource.fsPath)
    assert.strictEqual(lineNumber + 1, 101)
    const firstVisiblePositionUnbound = unboundEditor.visibleRanges[0].start
    const lineNumberUnbound = firstVisiblePositionUnbound.line
    assert.strictEqual(lineNumberUnbound, 0)
  })
  test('cnxml preview scroll sync does not update editor visible range if editor is scrolling (anti-jitter)', async () => {
    const uri = expect(getRootPathUri())
    const resource = uri.with({ path: path.join(uri.path, 'modules', 'm00001', 'index.cnxml') })
    const document = await vscode.workspace.openTextDocument(resource)
    await vscode.window.showTextDocument(document)

    // We need something long enough to scroll to
    const testData = `<document><pre>${'\n'.repeat(100)}</pre>Test<pre>${'\n'.repeat(100)}</pre></document>`
    const panel = new CnxmlPreviewPanel({ bookTocs: EMPTY_BOOKS_AND_ORPHANS, resourceRootDir, client: createMockClient(), events: createMockEvents().events })
    const boundEditor = expect(vscode.window.visibleTextEditors.find(editor => panel.isPreviewOf(editor.document.uri)))

    // reset revealed range
    const visualRangeReset = new Promise((resolve, reject) => {
      vscode.window.onDidChangeTextEditorVisibleRanges(() => { resolve(undefined) })
    })
    const range = new vscode.Range(0, 0, 1, 0)
    const strategy = vscode.TextEditorRevealType.AtTop
    boundEditor.revealRange(range, strategy)
    // Promise.race in case the visual range was already correct
    await Promise.race([visualRangeReset, sleep(500)])

    await replaceUriDocumentContent(resource, testData);

    // editor is scrolling
    (panel as any).resourceIsScrolling = true
    const visualRangeChanged = new Promise((resolve, reject) => {
      vscode.window.onDidChangeTextEditorVisibleRanges(() => { resolve(undefined) })
    })
    await panel.handleMessage({ type: 'scroll-in-editor', line: 101 })
    await Promise.race([visualRangeChanged, sleep(500)])

    const firstVisiblePosition = boundEditor.visibleRanges[0].start
    const lineNumber = firstVisiblePosition.line
    assert.strictEqual((panel as any).resourceBinding.fsPath, resource.fsPath)
    assert.strictEqual(lineNumber, 0)
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
  test('panel disposed and refocused', async () => {
    await assert.doesNotReject(async () => {
      await withPanelFromCommand(OpenstaxCommand.SHOW_TOC_EDITOR, async (panel) => { })
      await withPanelFromCommand(OpenstaxCommand.SHOW_TOC_EDITOR, async (panel) => { })
    })
  }).timeout(5000)
  test('panel hidden and refocused', async () => {
    const command = OpenstaxCommand.SHOW_IMAGE_MANAGER
    await vscode.commands.executeCommand(command)
    await sleep(100) // FIXME: Make me go away (see https://github.com/openstax/cnx/issues/1569)
    const panelManager = expect((await extensionExports)[command])

    // Hide panel by opening another tab
    const uri = expect(getRootPathUri())
    const resource = uri.with({ path: path.join(uri.path, 'modules', 'm00001', 'index.cnxml') })
    const document = await vscode.workspace.openTextDocument(resource)
    await vscode.window.showTextDocument(document)

    // Refocus
    await vscode.commands.executeCommand(command)
    // Give the panel time to load
    await sleep(500)
    assert(panelManager.panel()?.visible())
  }).timeout(5000)

  test('canPush returns correct values', async () => {
    const fileUri = { path: '/test.cnxml', scheme: 'file' } as any as vscode.Uri
    const cnxmlError = {
      severity: vscode.DiagnosticSeverity.Error,
      source: DiagnosticSource.cnxml
    } as any as vscode.Diagnostic
    const xmlError = {
      severity: vscode.DiagnosticSeverity.Error,
      source: DiagnosticSource.xml
    } as any as vscode.Diagnostic
    const errorsBySource = new Map<string, Array<[vscode.Uri, vscode.Diagnostic]>>()
    const showErrorMsgStub = sinon.stub(vscode.window, 'showErrorMessage')

    // No errors
    assert(await pushContent.canPush(errorsBySource))

    // CNXML errors
    errorsBySource.set(DiagnosticSource.cnxml, [[fileUri, cnxmlError]])
    assert(!(await pushContent.canPush(errorsBySource)))
    assert(showErrorMsgStub.calledOnceWith(pushContent.PushValidationModal.cnxmlErrorMsg, { modal: true }))

    // Both CNXML and XML errors
    errorsBySource.clear()
    showErrorMsgStub.reset()
    errorsBySource.set(DiagnosticSource.cnxml, [[fileUri, cnxmlError]])
    errorsBySource.set(DiagnosticSource.xml, [[fileUri, xmlError]])
    assert(!(await pushContent.canPush(errorsBySource)))
    assert(showErrorMsgStub.calledOnceWith(pushContent.PushValidationModal.cnxmlErrorMsg, { modal: true }))

    // XML errors, user cancels
    errorsBySource.clear()
    showErrorMsgStub.reset()
    showErrorMsgStub.returns(Promise.resolve(undefined))
    errorsBySource.set(DiagnosticSource.xml, [[fileUri, xmlError]])
    assert(!(await pushContent.canPush(errorsBySource)))
    assert(showErrorMsgStub.calledOnceWith(pushContent.PushValidationModal.xmlErrorMsg, { modal: true }))

    // XML errors, user overrides
    errorsBySource.clear()
    showErrorMsgStub.reset()
    showErrorMsgStub.returns(Promise.resolve(pushContent.PushValidationModal.xmlErrorIgnoreItem as any as vscode.MessageItem))
    errorsBySource.set(DiagnosticSource.xml, [[fileUri, xmlError]])
    assert(await pushContent.canPush(errorsBySource))
    assert(showErrorMsgStub.calledOnceWith(pushContent.PushValidationModal.xmlErrorMsg, { modal: true }))
  })
  test('forwardOnDidChangeWorkspaceFolders simply forwards any argument to client', async () => {
    const mockClient = createMockClient()
    const forwarder = forwardOnDidChangeWorkspaceFolders(mockClient)
    await forwarder('test_event' as unknown as vscode.WorkspaceFoldersChangeEvent)
    const expected = ['onDidChangeWorkspaceFolders', 'test_event']
    assert((mockClient.sendRequest as SinonRoot.SinonStub).calledOnceWith(...expected))
  })

  this.afterAll(async () => {
    await deactivate()
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

// Push Content Tests
const ignore = async (message: string): Promise<string | undefined> => { return undefined }

const makeCaptureMessage = (messages: string[]): (message: string) => Promise<string | undefined> => {
  return async (message: string): Promise<string | undefined> => {
    messages.push(message)
    return undefined
  }
}

const makeMockDialog = (message: string): () => Promise<string | undefined> => {
  return async (): Promise<string | undefined> => { return message }
}

const commitOptions: CommitOptions = { all: true }

export const makeMockNewTag = (tag: string | undefined): (repo: Repository, release: boolean) => string | undefined => {
  return (): string | undefined => {
    return tag
  }
}

suite('Push Button Test Suite', function (this: Suite) {
  const sinon = SinonRoot.createSandbox()
  this.afterEach(() => sinon.restore())
  const sendRequestMock = sinon.stub()
  const mockHostContext: ExtensionHostContext = {
    client: {
      sendRequest: sendRequestMock
    }
  } as any as ExtensionHostContext

  test('getRepo returns repository', async () => {
    const repo = pushContent.getRepo()
    assert.notStrictEqual(repo.rootUri, undefined)
  })
  test('push with no conflict', async () => {
    const messages: string[] = []
    const captureMessage = makeCaptureMessage(messages)
    const mockMessageInput = makeMockDialog('poet commit')

    const getRepo = (): Repository => {
      const stubRepo = Substitute.for<Repository>()

      stubRepo.commit('poet commit', commitOptions).resolves()
      stubRepo.pull().resolves()
      stubRepo.push().resolves()

      return stubRepo
    }

    await assert.doesNotReject(pushContent._pushContent(
      getRepo,
      mockMessageInput,
      captureMessage,
      ignore
    )())
    assert.strictEqual(messages.length, 1)
    assert.strictEqual(messages[0], 'Successful content push.')
  })
  test('push with merge conflict', async () => {
    const messages: string[] = []
    const captureMessage = makeCaptureMessage(messages)
    const mockMessageInput = makeMockDialog('poet commit')
    const error: any = { _fake: 'FakeSoStackTraceIsNotInConsole', message: '' }

    error.gitErrorCode = GitErrorCodes.Conflict

    const getRepo = (): Repository => {
      const stubRepo = Substitute.for<Repository>()

      stubRepo.commit('poet commit', commitOptions).resolves()
      stubRepo.pull().rejects(error)
      stubRepo.push().resolves()

      return stubRepo
    }

    await assert.doesNotReject(pushContent._pushContent(
      getRepo,
      mockMessageInput,
      ignore,
      captureMessage
    )())
    assert.strictEqual(messages.length, 1)
    assert.strictEqual(messages[0], 'Content conflict, please resolve.')
  })
  test('unknown commit error', async () => {
    const messages: string[] = []
    const captureMessage = makeCaptureMessage(messages)
    const mockMessageInput = makeMockDialog('poet commit')
    const error: any = { _fake: 'FakeSoStackTraceIsNotInConsole', message: '' }

    error.gitErrorCode = ''

    const getRepo = (): Repository => {
      const stubRepo = Substitute.for<Repository>()

      stubRepo.commit('poet commit', commitOptions).resolves()
      stubRepo.pull().rejects(error)
      stubRepo.push().resolves()

      return stubRepo
    }

    await assert.doesNotReject(pushContent._pushContent(
      getRepo,
      mockMessageInput,
      ignore,
      captureMessage
    )())
    assert.strictEqual(messages.length, 1)
    assert.strictEqual(messages[0], 'Push failed: ')
  })
  test('push with no changes', async () => {
    const messages: string[] = []
    const captureMessage = makeCaptureMessage(messages)
    const mockMessageInput = makeMockDialog('poet commit')
    const error: any = { _fake: 'FakeSoStackTraceIsNotInConsole', message: '' }

    error.stdout = 'nothing to commit.'

    const getRepo = (): Repository => {
      const stubRepo = Substitute.for<Repository>()
      stubRepo.diffWithHEAD().resolves([])
      stubRepo.commit('poet commit', commitOptions).rejects(error)
      stubRepo.pull().resolves()
      stubRepo.push().resolves()

      return stubRepo
    }

    await assert.doesNotReject(pushContent._pushContent(
      getRepo,
      mockMessageInput,
      ignore,
      captureMessage
    )())
    assert.strictEqual(messages.length, 1)
    assert.strictEqual(messages[0], 'No changes to push.')
  })
  test('unknown push error', async () => {
    const messages: string[] = []
    const captureMessage = makeCaptureMessage(messages)
    const mockMessageInput = makeMockDialog('poet commit')
    const error: any = { _fake: 'FakeSoStackTraceIsNotInConsole', message: '' }

    error.stdout = ''

    const getRepo = (): Repository => {
      const stubRepo = Substitute.for<Repository>()

      stubRepo.commit('poet commit', commitOptions).rejects(error)
      stubRepo.pull().resolves()
      stubRepo.push().resolves()

      return stubRepo
    }

    await assert.doesNotReject(pushContent._pushContent(
      getRepo,
      mockMessageInput,
      ignore,
      captureMessage
    )())
    assert.strictEqual(messages.length, 1)
    assert.strictEqual(messages[0], 'Push failed: ')
  })
  test('pushContent does not invoke _pushContent when canPush is false', async () => {
    sinon.stub(pushContent, 'canPush').resolves(false)
    const stubPushContentHelperInner = sinon.stub()
    sinon.stub(pushContent, '_pushContent').returns(stubPushContentHelperInner)
    await pushContent.pushContent(mockHostContext)()
    assert(stubPushContentHelperInner.notCalled)
    assert(sendRequestMock.notCalled)
  })
  test('pushContent invokes _pushContent when canPush is true', async () => {
    sinon.stub(pushContent, 'canPush').resolves(true)
    const stubPushContentHelperInner = sinon.stub()
    sinon.stub(pushContent, '_pushContent').returns(stubPushContentHelperInner)
    await pushContent.pushContent(mockHostContext)()
    assert(stubPushContentHelperInner.calledOnce)
    assert(sendRequestMock.calledOnceWith(
      ExtensionServerRequest.BundleEnsureIds
    ))
  })
  test('push to new branch', async () => {
    const messages: string[] = []
    const captureMessage = makeCaptureMessage(messages)
    const mockMessageInput = makeMockDialog('poet commit')
    const pushStub = sinon.stub()
    const newBranchName = 'newbranch'

    // This is inconsistent with the rest of this test suite, but it seems we can't use
    // a Substitute mock for this test case because setting return values on properties
    // requires disabling strict checking.
    // (https://github.com/ffMathy/FluffySpoon.JavaScript.Testing.Faking#strict-mode)
    const getRepo = (): Repository => {
      const repoBranch = {
        upstream: undefined,
        name: newBranchName
      } as any as Branch
      const repoState = {
        HEAD: repoBranch
      } as any as RepositoryState
      const stubRepo = {
        state: repoState,
        pull: sinon.stub(),
        push: pushStub,
        commit: sinon.stub()
      } as any as Repository

      return stubRepo
    }
    await assert.doesNotReject(pushContent._pushContent(
      getRepo,
      mockMessageInput,
      captureMessage,
      ignore
    )())
    assert.strictEqual(messages.length, 1)
    assert.strictEqual(messages[0], 'Successful content push.')
    assert(pushStub.calledOnceWith('origin', newBranchName, true))
  })
  test('get message returns showInputBox input', async () => {
    sinon.stub(vscode.window, 'showInputBox').resolves('test')
    assert.strictEqual(await pushContent.getMessage(), 'test')
  })
  test('validateMessage returns "Too short!" for message that is not long enough', async () => {
    assert.strictEqual(pushContent.validateMessage('a'), 'Too short!')
  })
  test('validateMessage returns null for message that is long enough', async () => {
    assert.strictEqual(pushContent.validateMessage('abc'), null)
  })
  test('taggingDialog', async () => {
    const mockDialog = sinon.stub(vscode.window, 'showInformationMessage')
    mockDialog.resolves(undefined)
    assert.strictEqual(await pushContent.taggingDialog(), undefined)
    mockDialog.resolves(pushContent.Tag.release as any as vscode.MessageItem)
    assert.strictEqual(await pushContent.taggingDialog(), pushContent.Tag.release)
    mockDialog.resolves(pushContent.Tag.candidate as any as vscode.MessageItem)
    assert.strictEqual(await pushContent.taggingDialog(), pushContent.Tag.candidate)
  })
  test('getNewTag', async () => {
    const repoState = {
      refs: [{
        name: 'main',
        type: RefType.Head,
        commit: 'a'
      }]
    } as any as RepositoryState
    const mockRepo = {
      state: repoState
    } as any as Repository
    const mockHead = {
      commit: 'a'
    } as any as Branch

    const showErrorMsgStub = sinon.stub(vscode.window, 'showErrorMessage')

    assert.strictEqual(await pushContent.getNewTag(mockRepo, pushContent.Tag.candidate, mockHead), '1rc')
    mockRepo.state.refs.push({
      name: '1rc',
      type: RefType.Tag,
      commit: 'b'
    })

    assert.strictEqual(await pushContent.getNewTag(mockRepo, pushContent.Tag.candidate, mockHead), '2rc')
    mockRepo.state.refs.push({
      name: '2rc',
      type: RefType.Tag,
      commit: 'a'
    })
    assert.strictEqual(await pushContent.getNewTag(mockRepo, pushContent.Tag.candidate, mockHead), undefined)
    assert(showErrorMsgStub.calledOnceWith('Tag of this type already exists for this content version.', { modal: false }))
    showErrorMsgStub.reset()

    mockRepo.state.refs.length = 0
    mockRepo.state.refs.push({
      name: 'main',
      type: RefType.Head,
      commit: 'a'
    })

    assert.strictEqual(await pushContent.getNewTag(mockRepo, pushContent.Tag.release, mockHead), '1')
    mockRepo.state.refs.push({
      name: '1',
      type: RefType.Tag,
      commit: 'b'
    })

    assert.strictEqual(await pushContent.getNewTag(mockRepo, pushContent.Tag.release, mockHead), '2')
    mockRepo.state.refs.push({
      name: '2',
      type: RefType.Tag,
      commit: 'a'
    })
    assert.strictEqual(await pushContent.getNewTag(mockRepo, pushContent.Tag.release, mockHead), undefined)
    assert(showErrorMsgStub.calledOnceWith('Tag of this type already exists for this content version.', { modal: false }))
  })
  test('tagContent', async () => {
    const showInfoMsgStub = sinon.stub(vscode.window, 'showInformationMessage')
    const showErrorMsgStub = sinon.stub(vscode.window, 'showErrorMessage')
    const taggingDialogStub = sinon.stub(pushContent, 'taggingDialog')
    const getNewTagStub = sinon.stub(pushContent, 'getNewTag')
    const diffWithHEADStub = sinon.stub()
    const tagStub = sinon.stub()
    const pushStub = sinon.stub()
    const fetchStub = sinon.stub()

    const repoBranch = {
      name: 'main'
    } as any as Branch
    const repoState = {
      HEAD: repoBranch
    } as any as RepositoryState
    const stubRepo = {
      state: repoState,
      fetch: fetchStub,
      diffWithHEAD: diffWithHEADStub,
      push: pushStub,
      _repository: {
        tag: tagStub
      }
    } as any as Repository

    sinon.stub(pushContent, 'getRepo').returns(stubRepo)

    // test for dirty workspace
    diffWithHEADStub.resolves([{}])
    await pushContent.tagContent()
    assert(fetchStub.calledOnce)
    assert(showErrorMsgStub.calledOnceWith('Can\'t tag. Local unpushed changes exist', { modal: false }))
    fetchStub.reset()
    showErrorMsgStub.reset()

    // test for canceled tagging
    taggingDialogStub.resolves(undefined)
    await pushContent.tagContent()
    assert(fetchStub.calledOnce)
    assert(getNewTagStub.notCalled)
    assert(tagStub.notCalled)
    fetchStub.reset()

    // test for existing tag
    diffWithHEADStub.resolves([])
    taggingDialogStub.resolves(pushContent.Tag.candidate)
    getNewTagStub.resolves(undefined)
    await pushContent.tagContent()
    assert(fetchStub.calledOnce)
    assert(getNewTagStub.calledOnce)
    assert(tagStub.notCalled)
    fetchStub.reset()
    getNewTagStub.reset()

    // test for valid tag
    taggingDialogStub.resolves(pushContent.Tag.candidate)
    getNewTagStub.resolves('1rc')
    await pushContent.tagContent()
    assert(fetchStub.calledOnce)
    assert(getNewTagStub.calledOnce)
    assert(tagStub.calledOnce)
    assert(pushStub.calledOnce)
    assert(showInfoMsgStub.calledOnceWith('Successful tag for Release Candidate.', { modal: false }))
    fetchStub.reset()
    getNewTagStub.reset()
    tagStub.reset()
    pushStub.reset()
    showInfoMsgStub.reset()
    showErrorMsgStub.reset()

    // test for unknown tag error message
    tagStub.throws()
    taggingDialogStub.resolves(pushContent.Tag.candidate)
    getNewTagStub.resolves('1rc')
    await pushContent.tagContent()
    assert(showErrorMsgStub.calledOnceWith('Tagging failed: Error', { modal: false }))
    fetchStub.reset()
    getNewTagStub.reset()
    tagStub.reset()
    pushStub.reset()
    showInfoMsgStub.reset()
    showErrorMsgStub.reset()

    // test for unknown push error message
    tagStub.resolves()
    pushStub.throws()
    taggingDialogStub.resolves(pushContent.Tag.candidate)
    getNewTagStub.resolves('1rc')
    await pushContent.tagContent()
    assert(showErrorMsgStub.calledOnceWith('Push failed: Error', { modal: false }))
    fetchStub.reset()
    getNewTagStub.reset()
    tagStub.reset()
    pushStub.reset()
    showInfoMsgStub.reset()
  })
  test('validateContent only runs when it should', async () => {
    const showInformationMessageStub = sinon.stub(vscode.window, 'showInformationMessage')
    const openAndValidateStub = sinon.stub(pushContent, 'openAndValidate')

    showInformationMessageStub.resolves(undefined)
    await pushContent.validateContent()
    assert(openAndValidateStub.notCalled)
    openAndValidateStub.reset()

    // 'as any' is required here because of showQuickPick overloading
    showInformationMessageStub.resolves(pushContent.DocumentsToOpen.all as any)
    await pushContent.validateContent()
    assert(openAndValidateStub.calledWith(pushContent.DocumentsToOpen.all))
  })
  test('getDocumentsToOpen returns all files', async () => {
    const findFilesStub = sinon.stub(vscode.workspace, 'findFiles')
    const filesToReturn = [vscode.Uri.file('/a'), vscode.Uri.file('/b'), vscode.Uri.file('/c')]
    const openDocuments = [vscode.Uri.file('/b').toString()]
    findFilesStub.resolves(filesToReturn)
    let toOpen = await pushContent.getDocumentsToOpen(pushContent.DocumentsToOpen.all, new Set())
    assert(findFilesStub.calledOnce)
    filesToReturn.forEach(uri => {
      assert(toOpen.has(uri.toString()))
    })

    // We do not need to open documents that are already open
    toOpen = await pushContent.getDocumentsToOpen(
      pushContent.DocumentsToOpen.all,
      new Set(openDocuments)
    )
    assert(!toOpen.has(openDocuments[0]))
  })
  test('getDocumentsToOpen returns changed files', async () => {
    const filesToReturn = [
      { uri: vscode.Uri.file('/a') },
      { uri: vscode.Uri.file('/b') },
      { uri: vscode.Uri.file('/c') }
    ]
    const openDocuments = [vscode.Uri.file('/b').toString()]
    const diffWithHEADStub = sinon.stub()
    const stubRepo = {
      diffWithHEAD: diffWithHEADStub
    } as any as Repository
    sinon.stub(pushContent, 'getRepo').returns(stubRepo)

    diffWithHEADStub.resolves(filesToReturn)
    let toOpen = await pushContent.getDocumentsToOpen(pushContent.DocumentsToOpen.modified, new Set())
    assert(diffWithHEADStub.calledOnce)
    filesToReturn.forEach(o => {
      assert(toOpen.has(o.uri.toString()))
    })

    // We do not need to open documents that are already open
    toOpen = await pushContent.getDocumentsToOpen(
      pushContent.DocumentsToOpen.modified,
      new Set(openDocuments)
    )
    assert(!toOpen.has(openDocuments[0]))
  })
  test('getOpenDocuments returns expected values', async () => {
    const activeTextEditorStub = sinon.stub(vscode.window, 'activeTextEditor')
    const executeCommandStub = sinon.stub(vscode.commands, 'executeCommand')

    activeTextEditorStub.get(() => undefined)
    let openDocuments = await pushContent.getOpenDocuments()
    assert(executeCommandStub.notCalled)
    assert.strictEqual(openDocuments.size, 0)
    executeCommandStub.reset()
    activeTextEditorStub.reset()

    // The expected behavior is for workbench.action.nextEditor to loop around to the first editor.
    // After it loops around, the document that getOpenDocuments started on will be added to the
    // set and the function will return.
    activeTextEditorStub.get(() => {
      // NOTE: executeCommandStub could be called with something other than nextEditor
      // Could this cause unexpected behavior? Stay tuned to find out!
      switch (executeCommandStub.callCount) {
        case 0:
        case 3:
          return { document: { uri: vscode.Uri.file('/a') } }
        case 1:
          return { document: { uri: vscode.Uri.file('/b') } }
        case 2:
          return { document: { uri: vscode.Uri.file('/c') } }
        default:
          throw new Error('Something went wrong when looking for documents')
      }
    })
    executeCommandStub.resolves()
    openDocuments = await pushContent.getOpenDocuments()
    assert.strictEqual(openDocuments.size, 3)
    assert.strictEqual(executeCommandStub.callCount, 3)
  })
  test('getOpenDocuments or openAndValidate canceled', async () => {
    const activeTextEditorStub = sinon.stub(vscode.window, 'activeTextEditor')
    const executeCommandStub = sinon.stub(vscode.commands, 'executeCommand')
    const withProgressStub = sinon.stub(vscode.window, 'withProgress')
    let error: Error | undefined
    activeTextEditorStub.get(() => ({ document: { uri: vscode.Uri.file('/a') } }))
    // I could stub vscode.CancellationSource, but this seems less error prone
    withProgressStub.callsFake((
      options: vscode.ProgressOptions,
      task: (
        progress: vscode.Progress<{ message?: string, increment?: number }>,
        token: vscode.CancellationToken
      ) => Thenable<unknown>
    ): Thenable<unknown> => {
      return new Promise((resolve, reject) => {
        try {
          resolve(task(
            { report: (_: { message?: string, increment?: number }) => {} },
            { isCancellationRequested: true, onCancellationRequested: sinon.stub() }
          ))
        } catch (e) {
          reject(e)
        }
      })
    })
    try {
      await pushContent.getOpenDocuments()
    } catch (e) {
      error = e as Error
    }
    assert(withProgressStub.calledOnce)
    assert(executeCommandStub.notCalled)
    assert.notStrictEqual(error, undefined)
    assert.strictEqual(error?.message, 'Canceled')
    withProgressStub.resetHistory()
    executeCommandStub.reset()
    error = undefined

    const getOpenDocumentsStub = sinon.stub(pushContent, 'getOpenDocuments')
    const getDocumentsToOpenStub = sinon.stub(pushContent, 'getDocumentsToOpen')
    getOpenDocumentsStub.resolves(new Set())
    getDocumentsToOpenStub.resolves(new Set(['not', 'used', 'here']))
    try {
      await pushContent.openAndValidate(pushContent.DocumentsToOpen.modified)
    } catch (e) {
      error = e as Error
    }
    assert(withProgressStub.calledOnce)
    assert(executeCommandStub.notCalled)
    assert.notStrictEqual(error, undefined)
    assert.strictEqual(error?.message, 'Canceled')
  })
  test('openAndValidate integration test', async () => {
    const dateNowStub = sinon.stub(Date, 'now')
    const withProgressStub = sinon.stub(vscode.window, 'withProgress')
    const getOpenDocumentsStub = sinon.stub(pushContent, 'getOpenDocuments')
    const getDocumentsToOpenStub = sinon.stub(pushContent, 'getDocumentsToOpen')
    const showTextDocumentStub = sinon.stub(vscode.window, 'showTextDocument')
      .callsFake((uri: vscode.Uri, options?: vscode.TextDocumentShowOptions): Thenable<vscode.TextEditor> => {
        return new Promise((resolve, reject) => resolve(
          { document: { uri: uri } as any as vscode.TextDocument } as any as vscode.TextEditor
        ))
      })
    const executeCommandStub = sinon.stub(vscode.commands, 'executeCommand').resolves()
    const filesToReturn = [vscode.Uri.file('/a'), vscode.Uri.file('/b'), vscode.Uri.file('/c')]
    let dateNowCallCount = 0
    let progressReportCount = 0
    sinon.stub(pushContent, 'sleep').resolves()
    // Cover situations that take more than 10 seconds
    dateNowStub.callsFake(() => dateNowCallCount++ * 10000)
    getOpenDocumentsStub.resolves(new Set())
    getDocumentsToOpenStub.resolves(new Set(filesToReturn.map(uri => uri.toString())))
    withProgressStub.callsFake((
      options: vscode.ProgressOptions,
      task: (
        progress: vscode.Progress<{ message?: string, increment?: number }>,
        token: vscode.CancellationToken
      ) => Thenable<unknown>
    ): Thenable<unknown> => {
      return new Promise((resolve, reject) => {
        try {
          resolve(task(
            {
              report: (value: { message?: string, increment?: number }) => {
                progressReportCount++
                assert(
                  value.message !== undefined &&
                  value.message.length > 0 && (
                    // make sure the time estimate is only added after the first progress report
                    progressReportCount > 1
                      ? value.message.includes('remaining')
                      : !value.message.includes('remaining')
                  )
                )
              }
            },
            { isCancellationRequested: false, onCancellationRequested: sinon.stub() }
          ))
        } catch (e) {
          reject(e)
        }
      })
    })

    let errors = await pushContent.openAndValidate(pushContent.DocumentsToOpen.all)
    assert.strictEqual([...errors.values()].flat().length, 0)
    filesToReturn.forEach(uri => {
      assert(showTextDocumentStub.calledWith(uri))
    })
    assert(getOpenDocumentsStub.called)
    assert(executeCommandStub.calledWith('workbench.action.closeActiveEditor'))
    assert.strictEqual(executeCommandStub.callCount, 3) // Close three documents with no errors
    assert.strictEqual(dateNowStub.callCount, 11)
    assert.strictEqual(withProgressStub.callCount, 1)
    assert.strictEqual(progressReportCount, 4) // 1 extra call to get the progress bar spinning
    getOpenDocumentsStub.resetHistory()
    executeCommandStub.resetHistory()
    withProgressStub.resetHistory()
    showTextDocumentStub.resetHistory()
    progressReportCount = 0
    dateNowStub.reset()

    // Test for cases where errors appear (when documents should not be closed)
    const file1Diag1 = { severity: vscode.DiagnosticSeverity.Error, source: 'source1' } as any as vscode.Diagnostic
    const testDiagnostics: Array<[vscode.Uri, vscode.Diagnostic[]]> = [
      [filesToReturn[0], [file1Diag1]]
    ]
    // Cover situations that take a very small amount of time
    dateNowStub.callThrough()
    sinon.stub(vscode.languages, 'getDiagnostics').returns(testDiagnostics)
    errors = await pushContent.openAndValidate(pushContent.DocumentsToOpen.all)
    assert.strictEqual([...errors.values()].flat().length, 1)
    filesToReturn.forEach(uri => {
      assert(showTextDocumentStub.calledWith(uri))
    })
    assert(getOpenDocumentsStub.called)
    assert(executeCommandStub.calledWith('workbench.action.closeActiveEditor'))
    assert.strictEqual(executeCommandStub.callCount, 2) // Close two documents with no errors
    assert.strictEqual(dateNowStub.callCount, 5)
    assert.strictEqual(withProgressStub.callCount, 1)
    assert.strictEqual(progressReportCount, 1) // Just the 1 to get the progress bar spinning
  })
})
