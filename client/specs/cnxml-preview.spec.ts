import { expect } from '@jest/globals'
import SinonRoot from 'sinon'
import mockfs from 'mock-fs'

import { DOMParser, XMLSerializer } from 'xmldom'
import { CnxmlPreviewPanel, rawTextHtml, tagElementsWithLineNumbers } from '../src/panel-cnxml-preview'

import vscode, { type TextDocument, type Uri } from 'vscode'
import * as utils from '../src/utils' // Used for dependency mocking in tests
import { EMPTY_BOOKS_AND_ORPHANS } from '../../common/src/requests'
import { join } from 'path'
import { type ExtensionEvents } from '../src/panel'
import { type LanguageClient } from 'vscode-languageclient/node'
import { PanelStateMessageType } from '../../common/src/webview-constants'
import { readFileSync } from 'fs'

const actualResourceRootDir = join(__dirname, '../static')
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

function expectValue<T>(v: T | null | undefined) {
  if (v === null || v === undefined) {
    throw new Error('BUG: Value is null/undefined but it should not have been')
  }
  return v
}

function makeDocument(uri: Uri, content: string) {
  const document: vscode.TextDocument = {
    uri,
    languageId: 'xml',
    lineAt: () => ({ text: 'fakedata2' }),
    positionAt: () => -123,
    getText: () => content,
    __thisismockedfortesting: true
    // ...
  } as unknown as vscode.TextDocument
  return document
}

function makeEditor(uri: Uri, content: string) {
  const editor: vscode.TextEditor = {
    document: makeDocument(uri, content),
    revealRange: () => { },
    __thisismockedfortesting: true
    // ...
  } as unknown as vscode.TextEditor

  vscode.window.visibleTextEditors = [...vscode.window.visibleTextEditors, editor] // add the editor
  return editor
}

describe('cnxml-preview', () => {
  describe('simple', () => {
    it('tagElementsWithLineNumbers', () => {
      const xml = `
      <document>
          <div><span>Test</span><div/></div>
      </document>`
      const doc = new DOMParser().parseFromString(xml)
      tagElementsWithLineNumbers(doc)
      const out = new XMLSerializer().serializeToString(doc)
      expect(out).toMatchSnapshot()
    })

    it('raw text html content for webview use', () => {
      const content = 'test'
      expect(rawTextHtml(content)).toBe('<html><body>test</body></html>')
    })
    it('raw text html content for webview use disallows potential unsafe text', () => {
      const content = '<injected></injected>'
      expect(() => { rawTextHtml(content) }).toThrow()
    })
  })

  describe('complex', () => {
    const fakeWorkspacePath = '/tmp/fakeworkspace'
    const resourceRootDir = 'fakeresourcerootdir'
    let resourceFirst = undefined as unknown as Uri
    let resourceSecond = undefined as unknown as Uri
    let resourceThird = undefined as unknown as Uri
    let resourceBook = undefined as unknown as Uri
    let onDidChangeActiveTextEditor = undefined as unknown as SinonRoot.SinonStub

    const sinon = SinonRoot.createSandbox()
    const createMockClient = (): LanguageClient => {
      return {
        sendRequest: sinon.stub().returns([]),
        onRequest: sinon.stub().returns({ dispose: () => { } })
      } as unknown as LanguageClient
    }
    const { emitters, events } = createMockEvents()
    function setActiveEditor(uri: Uri, languageId = 'xml') {
      const fakeEditor: vscode.TextEditor = {
        document: {
          lineAt: () => ({ text: 'fakedata' }),
          languageId,
          uri
        },
        // used by panel-cnxml-preview scrollToRangeStartOfEditor
        visibleRanges: [
          {
            start: {
              line: 0,
              character: 0
            }
          }
        ]
      } as any
      vscode.window.activeTextEditor = fakeEditor
      onDidChangeActiveTextEditor.getCalls().forEach(c => c.firstArg(fakeEditor))
      emitters.onDidChangeWatchedFiles.fire()
    }

    beforeEach(() => {
      sinon.stub(utils, 'getRootPathUri').returns(vscode.Uri.file(fakeWorkspacePath))
      onDidChangeActiveTextEditor = sinon.stub(vscode.window, 'onDidChangeActiveTextEditor')
      const fs: any = {}
      fs[resourceRootDir] = mockfs.load(actualResourceRootDir)

      const uri = expectValue(utils.getRootPathUri())
      resourceFirst = uri.with({ path: join(uri.path, 'modules', 'm00001', 'index.cnxml') })
      resourceSecond = uri.with({ path: join(uri.path, 'modules', 'm00002', 'index.cnxml') })
      resourceThird = uri.with({ path: join(uri.path, 'README.md') })
      resourceBook = uri.with({ path: join(uri.path, 'collections', 'book1.collection.xml') })
      fs[resourceFirst.fsPath] = '<document id="1" xmlns="http://cnx.rice.edu/cnxml"><content><para>Fake Test Document</para></content></document>'
      fs[resourceSecond.fsPath] = '<document id="2" xmlns="http://cnx.rice.edu/cnxml"><content><para>Fake Test Document</para></content></document>'
      fs[resourceThird.fsPath] = 'Dummy readme. The contents should not actually matter'
      fs[resourceBook.fsPath] = 'Does not actually need to be valid XML'

      mockfs(fs)

      const otd = sinon.stub(vscode.workspace, 'openTextDocument')
      otd.resolves('I am a text document' as unknown as TextDocument)
    })
    afterEach(() => {
      mockfs.restore()
      sinon.restore()
    })

    it('rebinds to resource in the active editor', async () => {
      const panel = new CnxmlPreviewPanel({ bookTocs: EMPTY_BOOKS_AND_ORPHANS, resourceRootDir, client: createMockClient(), events })
      const postMessage = sinon.spy(panel, 'postMessage')
      expect((panel as any).resourceBinding).toBe(null)

      const documentFirst = await vscode.workspace.openTextDocument(resourceFirst)
      await vscode.window.showTextDocument(documentFirst, vscode.ViewColumn.Two)
      const contentFromFsBecauseVscodeLiesAboutDocumentContentFirst = readFileSync(resourceFirst.fsPath, { encoding: 'utf-8' })
      const documentDomFirst = new DOMParser().parseFromString(contentFromFsBecauseVscodeLiesAboutDocumentContentFirst)
      tagElementsWithLineNumbers(documentDomFirst)
      const xmlExpectedFirst = new XMLSerializer().serializeToString(documentDomFirst)

      setActiveEditor(resourceFirst)

      expect((panel as any).panel.webview.html).toEqual(expect.stringContaining(JSON.stringify(xmlExpectedFirst)))
      expect((panel as any).resourceBinding.fsPath).toBe(resourceFirst.fsPath)

      const documentSecond = await vscode.workspace.openTextDocument(resourceSecond)
      await vscode.window.showTextDocument(documentSecond, vscode.ViewColumn.Two)
      const contentFromFsBecauseVscodeLiesAboutDocumentContentSecond = readFileSync(resourceSecond.fsPath, { encoding: 'utf-8' })
      const documentDomSecond = new DOMParser().parseFromString(contentFromFsBecauseVscodeLiesAboutDocumentContentSecond)
      tagElementsWithLineNumbers(documentDomSecond)
      const xmlExpectedSecond = new XMLSerializer().serializeToString(documentDomSecond)

      setActiveEditor(resourceSecond)

      const xsl = readFileSync(
        join(resourceRootDir, 'cnxml-to-html5.xsl'),
        'utf-8'
      )
      expect(postMessage.calledWith({ type: PanelStateMessageType.Response, state: { xml: xmlExpectedSecond, xsl } })).toBe(true)
      expect((panel as any).resourceBinding.fsPath).toBe(resourceSecond.fsPath)
    })

    it('only rebinds to cnxml', async () => {
      const panel = new CnxmlPreviewPanel({ bookTocs: EMPTY_BOOKS_AND_ORPHANS, resourceRootDir, client: createMockClient(), events })
      const postMessage = sinon.spy(panel, 'postMessage')

      const documentFirst = await vscode.workspace.openTextDocument(resourceFirst)
      await vscode.window.showTextDocument(documentFirst, vscode.ViewColumn.Two)
      const documentDomFirst = new DOMParser().parseFromString(readFileSync(resourceFirst.fsPath, 'utf-8'))
      tagElementsWithLineNumbers(documentDomFirst)
      const xmlExpectedFirst = new XMLSerializer().serializeToString(documentDomFirst)

      setActiveEditor(resourceFirst)

      const documentSecond = await vscode.workspace.openTextDocument(resourceSecond)
      await vscode.window.showTextDocument(documentSecond, vscode.ViewColumn.Two)

      setActiveEditor(resourceSecond)

      const documentThird = await vscode.workspace.openTextDocument(resourceThird)
      await vscode.window.showTextDocument(documentThird, vscode.ViewColumn.Two)

      setActiveEditor(resourceThird, 'text')

      expect((panel as any).panel.webview.html.includes(JSON.stringify(xmlExpectedFirst)))
      const refreshCalls = postMessage
        .getCalls()
        .filter(call => call.args.some(arg => arg.type != null && arg.type === PanelStateMessageType.Response))
      expect(refreshCalls.length).toBe(4) // not sure why
      expect((panel as any).resourceBinding.fsPath).toBe(resourceSecond.fsPath)
    })

    it('refuses refresh if no resource bound', async () => {
      const panel = new CnxmlPreviewPanel({ bookTocs: EMPTY_BOOKS_AND_ORPHANS, resourceRootDir, client: createMockClient(), events: createMockEvents().events })
      const postMessage = sinon.spy(panel, 'postMessage')
      expect(panel.isPreviewOf(null)).toBe(true)
      await (panel as any).tryRebindToResource(null)
      await (panel as any).rebindToResource(null)
      const refreshCalls = postMessage
        .getCalls()
        .filter(call => call.args.some(arg => arg.type != null && arg.type === PanelStateMessageType.Response))
      expect(refreshCalls.length).toBe(0)
    })

    describe('using onDidChangeTextEditorVisibleRanges', () => {
      let odctevr = undefined as unknown as SinonRoot.SinonSpy<[listener: (e: vscode.TextEditorVisibleRangesChangeEvent) => any, thisArgs?: any, disposables?: vscode.Disposable[] | undefined], vscode.Disposable>
      beforeEach(() => {
        odctevr = sinon.spy(vscode.window, 'onDidChangeTextEditorVisibleRanges')
      })
      function revealRange(textEditor: vscode.TextEditor, range: vscode.Range, strategy: vscode.TextEditorRevealType) {
        (textEditor as any).visibleRanges = [range]
        const evt: vscode.TextEditorVisibleRangesChangeEvent = {
          textEditor,
          visibleRanges: [range]
        }
        odctevr.getCalls().forEach(c => c.firstArg(evt))
      }

      it('messaged upon visible range change', async () => {
        const testData = `<document><pre>${'\n'.repeat(100)}</pre>Test<pre>${'\n'.repeat(100)}</pre></document>`

        // An editor not bound to the panel
        const resourceIrrelevant = resourceSecond
        const unboundEditor = makeEditor(resourceIrrelevant, testData)

        // The editor we are bound to
        const resource = resourceFirst
        const boundEditor = makeEditor(resource, testData)

        // We need something long enough to scroll in
        const panel = new CnxmlPreviewPanel({ bookTocs: EMPTY_BOOKS_AND_ORPHANS, resourceRootDir, client: createMockClient(), events: createMockEvents().events })
        const postMessage = sinon.spy(panel, 'postMessage')

        setActiveEditor(resource)

        const resetRange = new vscode.Range(0, 0, 1, 0)
        const range = new vscode.Range(100, 0, 101, 0)

        const resetStrategy = vscode.TextEditorRevealType.AtTop
        revealRange(boundEditor, resetRange, resetStrategy)
        revealRange(unboundEditor, resetRange, resetStrategy)

        const strategy = vscode.TextEditorRevealType.AtTop

        revealRange(unboundEditor, range, strategy)

        expect(postMessage.getCalls().length).toBe(2) // just 2 init "scroll to line 1" events
        expect(postMessage.calledWith({ type: 'scroll-in-preview', line: 100 })).toBe(false)
        expect(postMessage.calledWith({ type: 'scroll-in-preview', line: 101 })).toBe(false)

        revealRange(boundEditor, range, strategy)
        expect(postMessage.calledWith({ type: 'scroll-in-preview', line: 101 })).toBe(true)
      })

      it('scroll sync in editor updates visible range', async () => {
        // We need something long enough to scroll to
        const testData = `<document><pre>${'\n'.repeat(100)}</pre>Test<pre>${'\n'.repeat(100)}</pre></document>`
        const panel = new CnxmlPreviewPanel({ bookTocs: EMPTY_BOOKS_AND_ORPHANS, resourceRootDir, client: createMockClient(), events: createMockEvents().events })

        // An editor we should not scroll in
        const resourceIrrelevant = resourceSecond
        const unboundEditor = makeEditor(resourceIrrelevant, testData)

        // The actual editor we are scrolling in
        const resource = resourceFirst
        const boundEditor = makeEditor(resource, testData)

        setActiveEditor(resource)

        // reset revealed range
        const range = new vscode.Range(0, 0, 1, 0)
        const strategy = vscode.TextEditorRevealType.AtTop
        revealRange(boundEditor, range, strategy)
        revealRange(unboundEditor, range, strategy)

        // ensure scrollable
        ;(panel as any).resourceIsScrolling = false
        const rr = sinon.stub(boundEditor, 'revealRange').returns(undefined)
        await panel.handleMessage({ type: 'scroll-in-editor', line: 101 })
        expect(rr.getCalls()).not.toEqual([])
        expect(rr.firstCall.args[0]).toEqual({ end: { character: 0, line: 101 }, start: { character: 0, line: 100 } })
      })

      it('scroll sync does not update editor visible range if editor is scrolling (anti-jitter)', async () => {
        // We need something long enough to scroll to
        const testData = `<document><pre>${'\n'.repeat(100)}</pre>Test<pre>${'\n'.repeat(100)}</pre></document>`
        const panel = new CnxmlPreviewPanel({ bookTocs: EMPTY_BOOKS_AND_ORPHANS, resourceRootDir, client: createMockClient(), events: createMockEvents().events })

        const resource = resourceFirst
        const boundEditor = makeEditor(resource, testData)

        const range = new vscode.Range(0, 0, 1, 0)
        const strategy = vscode.TextEditorRevealType.AtTop
        revealRange(boundEditor, range, strategy)

        // editor is scrolling
        ;(panel as any).resourceIsScrolling = true
        await panel.handleMessage({ type: 'scroll-in-editor', line: 101 })

        const firstVisiblePosition = boundEditor.visibleRanges[0].start
        const lineNumber = firstVisiblePosition.line
        expect((panel as any).resourceBinding.fsPath).toBe(resource.fsPath)
        expect(lineNumber).toBe(0)
      })

      it('refreshes when server watched file changes', async () => {
        const mockEvents = createMockEvents()
        const watchedFilesSpy = sinon.spy(mockEvents.events, 'onDidChangeWatchedFiles')
        const resource = resourceFirst
        const panel = new CnxmlPreviewPanel({ bookTocs: EMPTY_BOOKS_AND_ORPHANS, resourceRootDir, client: createMockClient(), events: mockEvents.events })
        const rebindingStub = sinon.spy(panel as any, 'rebindToResource')
        setActiveEditor(resource)
        const refreshCount = rebindingStub.callCount
        await watchedFilesSpy.getCall(0).args[0]()
        expect(rebindingStub.callCount).toBe(refreshCount + 1)
      })
    })
  })
})
