import expect from 'expect'
import SinonRoot from 'sinon'
import mockfs from 'mock-fs'

import { DOMParser, XMLSerializer } from 'xmldom'
import { CnxmlPreviewPanel, rawTextHtml, tagElementsWithLineNumbers } from '../src/panel-cnxml-preview'

import vscode, { TextDocument, Uri } from 'vscode'
import * as utils from '../src/utils' // Used for dependency mocking in tests
import { EMPTY_BOOKS_AND_ORPHANS } from '../../common/src/requests'
import { join } from 'path'
import { ExtensionEvents } from '../src/panel'
import { LanguageClient } from 'vscode-languageclient/node'
import { PanelStateMessageType } from '../../common/src/webview-constants'
import { readFileSync, writeFileSync } from 'fs'

const actualResourceRootDir = join(__dirname, '../static')
const actualWorkspaceRootDir = join(__dirname, '../..')
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
          languageId: languageId,
          uri: uri
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
      emitters.onDidChangeWatchedFiles.fire()
    }

    beforeEach(() => {
      sinon.stub(utils, 'getRootPathUri').returns(vscode.Uri.file(fakeWorkspacePath))
      const fs: any = {}
      fs[resourceRootDir] = mockfs.load(actualResourceRootDir)

      const uri = expectValue(utils.getRootPathUri())
      resourceFirst = uri.with({ path: join(uri.path, 'modules', 'm00001', 'index.cnxml') })
      resourceSecond = uri.with({ path: join(uri.path, 'modules', 'm00002', 'index.cnxml') })
      resourceThird = uri.with({ path: join(uri.path, 'README.md') })
      resourceBook = uri.with({ path: join(uri.path, 'collections', 'book1.collection.xml')})
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

    it('cnxml preview rebinds to resource in the active editor', async () => {
      const panel = new CnxmlPreviewPanel({ bookTocs: EMPTY_BOOKS_AND_ORPHANS, resourceRootDir, client: createMockClient(), events: events })
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
      expect(postMessage.callCount).toBe(3) // scroll + load second document + scroll
      expect(postMessage.calledWith({ type: PanelStateMessageType.Response, state: { xml: xmlExpectedSecond, xsl: xsl } })).toBe(true)
      expect((panel as any).resourceBinding.fsPath).toBe(resourceSecond.fsPath)
    })

    it('cnxml preview only rebinds to cnxml', async () => {
      const panel = new CnxmlPreviewPanel({ bookTocs: EMPTY_BOOKS_AND_ORPHANS, resourceRootDir, client: createMockClient(), events: events })
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
      expect(refreshCalls.length).toBe(2)
      expect((panel as any).resourceBinding.fsPath).toBe(resourceSecond.fsPath)
    })

    it('cnxml preview refuses refresh if no resource bound', async () => {
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
  })
})
