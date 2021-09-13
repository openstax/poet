import assert from 'assert'
import fs from 'fs-extra'
import path from 'path'
import vscode from 'vscode'
import SinonRoot from 'sinon'
import { GitErrorCodes, Repository, CommitOptions, RepositoryState, Branch, RefType } from '../../git-api/git.d'
import 'source-map-support/register'
import {
  expect as expectOrig, ensureCatch, getRootPathUri,
  fixResourceReferences, fixCspSourceReferences, addBaseHref, populateXsdSchemaFiles,
  getErrorDiagnosticsBySource,
  ensureCatchPromise
} from './../../utils'
import { activate, deactivate, forwardOnDidChangeWorkspaceFolders } from './../../extension'
import { TocEditorPanel } from './../../panel-toc-editor'
import { ImageManagerPanel } from './../../panel-image-manager'
import { CnxmlPreviewPanel, rawTextHtml, tagElementsWithLineNumbers } from './../../panel-cnxml-preview'
import { BookRootNode, BookToc, TocNodeKind } from '../../../../common/src/toc-tree'
import { OpenstaxCommand } from '../../extension-types'
import * as pushContent from '../../push-content'
import { Suite } from 'mocha'
import { DOMParser, XMLSerializer } from 'xmldom'
import { Substitute } from '@fluffy-spoon/substitute'
import { LanguageClient } from 'vscode-languageclient/node'
import { DEFAULT_BOOK_TOCS_ARGS, DiagnosticSource, ExtensionServerRequest } from '../../../../common/src/requests'
import { Disposer, ExtensionEvents, ExtensionHostContext, Panel } from '../../panel'
import { TocTreesProvider, TocTreeItem, toggleTocTreesFilteringHandler, TocItemIcon } from './../../toc-trees'
import * as utils from './../../utils' // Used for dependency mocking in tests
import { BookOrTocNode, TocsTreeProvider } from '../../book-tocs'

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

const withTestPanel = (html: string, func: (arg0: vscode.WebviewPanel) => void): void => {
  const panel = vscode.window.createWebviewPanel(
    'openstax.testPanel',
    'Test Panel',
    vscode.ViewColumn.One,
    {
      enableScripts: true
    }
  )
  panel.reveal(vscode.ViewColumn.One)
  panel.webview.html = html
  func(panel)
  panel.dispose()
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

  test('expect unwraps non-null', () => {
    const maybe: string | null = 'test'
    assert.doesNotThrow(() => { expect(maybe) })
  })
  test('expect throws on null', async () => {
    const maybe: string | null = null
    assert.throws(() => { expect(maybe) })
  })
  test('expect throws on null with custom message', async () => {
    const maybe: string | null = null
    assert.throws(() => { expectOrig(maybe, 'my-message') })
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
  test('ensureCatch throws when its argument throws', async () => {
    const errMessage = 'I am an error'
    async function fn(): Promise<void> { throw new Error(errMessage) }
    const s = sinon.spy(vscode.window, 'showErrorMessage')
    const wrapped = ensureCatch(fn)

    try {
      await wrapped()
      assert.fail('ensureCatch should have thrown an error')
    } catch (err) {
      assert.strictEqual(err.message, errMessage)
    }
    // Verify that a message was sent to the user
    assert.strictEqual(s.callCount, 1)
  })
  test('ensureCatchPromise throws when its argument rejects', async () => {
    const errMessage = 'I am an error'
    async function fn(): Promise<void> { throw new Error(errMessage) }
    const s = sinon.spy(vscode.window, 'showErrorMessage')
    const promise = fn()
    const caughtPromise = ensureCatchPromise(promise)
    try {
      await caughtPromise
      assert.fail('ensureCatch should have thrown an error')
    } catch (err) {
      assert.strictEqual(err.message, errMessage)
    }
    // Verify that a message was sent to the user
    assert.strictEqual(s.callCount, 1)
  })
  test('addBaseHref', () => {
    const uri = expect(getRootPathUri())
    const resource = uri.with({ path: path.join(uri.path, 'modules', 'm00001', 'index.cnxml') })
    // eslint-disable-next-line no-template-curly-in-string
    const html = '<document><base href="${BASE_URI}"/></document>'
    withTestPanel(
      html,
      (panel) => {
        const modified = addBaseHref(panel.webview, resource, html)
        assert(modified.includes('vscode-webview'))
      }
    )
  })
  test('fixResourceReferences relative', () => {
    const html = '<document><a href="./media/some-image.jpg"></a></document>'
    withTestPanel(
      html,
      (panel) => {
        const modified = fixResourceReferences(panel.webview, html, TEST_DATA_DIR)
        assert(modified.includes('vscode-webview'))
      }
    )
  })
  test('fixResourceReferences non-relative', () => {
    const html = '<document><a href="media/some-image.jpg"></a></document>'
    withTestPanel(
      html,
      (panel) => {
        const modified = fixResourceReferences(panel.webview, html, TEST_DATA_DIR)
        assert.strictEqual(modified, html) // No change when no './' before href
      }
    )
  })
  test('fixCspSourceReferences', () => {
    // eslint-disable-next-line no-template-curly-in-string
    const html = '<document><meta content="${WEBVIEW_CSPSOURCE}"</meta></document>'
    withTestPanel(
      html,
      (panel) => {
        const modified = fixCspSourceReferences(panel.webview, html)
        assert(modified.includes('vscode-webview'))
      }
    )
  })
  test('injectEnsuredMessages no body is noop', () => {
    const html = '<html></html>'
    assert.strictEqual(Panel.prototype.injectEnsuredMessages(html, [{ test: 'abc' }]), html)
  })
  test('injectEnsuredMessages injects messages', () => {
    const html = '<html><body></body></html>'
    const result = Panel.prototype.injectEnsuredMessages(html, [{ test: 'abc' }])
    console.log(result)
    assert(result.includes('script'))
    assert(result.includes('[{"test":"abc"}]'))
  })
  test('injectEnsuredMessages zero length messages is noop', () => {
    const html = '<html><body></body></html>'
    assert.strictEqual(Panel.prototype.injectEnsuredMessages(html, []), html)
  })
  test('tagElementsWithLineNumbers', async () => {
    const xml = `
      <document>
        <div><span>Test</span><div/></div>
      </document>`
    const doc = new DOMParser().parseFromString(xml)
    tagElementsWithLineNumbers(doc)
    const out = new XMLSerializer().serializeToString(doc)
    const expected = `
      <document data-line="2">
        <div data-line="3"><span data-line="3">Test</span><div data-line="3"/></div>
      </document>`
    assert.strictEqual(out, expected)
  })
  test('show toc editor', async () => {
    await withPanelFromCommand(OpenstaxCommand.SHOW_TOC_EDITOR, async (panel) => {
      const html = panel.webview.html
      assert.notStrictEqual(html, null)
      assert.notStrictEqual(html, undefined)
      assert.notStrictEqual(html.indexOf('html'), -1)
    })
  }).timeout(5000)
  // test('toc editor refresh makes proper language server requests', async () => {
  //   const mockClient = createMockClient()
  //   const panel = new TocEditorPanel({ bookTocs: DEFAULT_BOOK_TOCS_ARGS, resourceRootDir, client: mockClient, events: createMockEvents().events })
  //   await panel.handleMessage({ type: 'refresh' })
  //   const expectedCalls = [
  //     [ExtensionServerRequest.BundleModules, { workspaceUri: `file://${TEST_DATA_DIR}` }],
  //     [ExtensionServerRequest.BundleOrphanedModules, { workspaceUri: `file://${TEST_DATA_DIR}` }]
  //   ]
  //   assert.strictEqual((mockClient.sendRequest as SinonRoot.SinonStub).getCalls().length, 3)
  //   for (const args of expectedCalls) {
  //     assert((mockClient.sendRequest as SinonRoot.SinonStub).calledWith(...args))
  //   }
  // }).timeout(5000)
  // test('toc editor refresh makes no request when disposed', async () => {
  //   const mockClient = createMockClient()
  //   const panel = new TocEditorPanel({ bookTocs: DEFAULT_BOOK_TOCS_ARGS, resourceRootDir, client: mockClient, events: createMockEvents().events })
  //   panel.dispose()
  //   await panel.handleMessage({ type: 'refresh' })
  //   assert((mockClient.sendRequest as SinonRoot.SinonStub).notCalled)
  // })

  // const mockEditAddModule: BookToc = {
  //   type: BookRootNode.Singleton,
  //   title: 'test collection',
  //   slug: 'test',
  //   uuid: '',
  //   language: '',
  //   licenseUrl: '',
  //   absPath: 'path/to/nowhere-book',
  //   tree: [{
  //     type: TocNodeKind.Inner,
  //     value: { token: 'id123', title: 'subcollection' },
  //     children: [{
  //       type: TocNodeKind.Leaf,
  //       value: {
  //         token: 'id234',
  //         absPath: 'path/to/nowhere',
  //         fileId: 'm00001',
  //         title: 'Introduction'
  //       }
  //     }]
  //   }, {
  //     type: TocNodeKind.Leaf,
  //     value: {
  //       token: 'id345',
  //       absPath: 'path/to/nowhere2',
  //       fileId: 'm00002',
  //       title: 'Unnamed Module'
  //     }
  //   }]
  // }

  //   test('toc editor handle data message', async () => {
  //     const uri = expect(getRootPathUri())
  //     const collectionPath = path.join(uri.fsPath, 'collections', 'test.collection.xml')
  //     const before = fs.readFileSync(collectionPath)
  //     await withPanelFromCommand(OpenstaxCommand.SHOW_TOC_EDITOR, async (panel) => {
  //       const handler = tocEditorHandleMessage(panel, createMockClient())
  //       await handler({ type: 'write-tree', treeData: mockEditAddModule })
  //     })
  //     const after = fs.readFileSync(collectionPath, { encoding: 'utf-8' })
  //     assert.strictEqual(before.indexOf('m00002'), -1)
  //     assert.notStrictEqual(after.indexOf('m00002'), -1)
  //   }).timeout(5000)
  //   test('toc editor writes expected collection schema', async () => {
  //     const uri = expect(getRootPathUri())
  //     const collectionPath = path.join(uri.fsPath, 'collections', 'test.collection.xml')
  //     await withPanelFromCommand(OpenstaxCommand.SHOW_TOC_EDITOR, async (panel) => {
  //       const handler = tocEditorHandleMessage(panel, createMockClient())
  //       await handler({ type: 'write-tree', treeData: mockEditAddModule })
  //     })
  //     const result = fs.readFileSync(collectionPath, { encoding: 'utf-8' })
  //     const expected =
  // `<col:collection xmlns:col="http://cnx.rice.edu/collxml" xmlns:md="http://cnx.rice.edu/mdml" xmlns="http://cnx.rice.edu/collxml">
  //   <col:metadata>
  //     <md:content-id>col00042</md:content-id>
  //     <md:title>test collection</md:title>
  //     <md:slug>test</md:slug>
  //     <md:language>en</md:language>
  //     <md:uuid>e36d32a7-1379-4690-a029-e37246102438</md:uuid>
  //     <md:license url="http://creativecommons.org/licenses/by/4.0/">Creative Commons Attribution License 4.0</md:license>
  //   </col:metadata>
  //   <content>
  //     <subcollection>
  //       <md:title>subcollection</md:title>
  //       <content>
  //         <module document="m00001"/>
  //       </content>
  //     </subcollection>
  //     <module document="m00002"/>
  //   </content>
  // </col:collection>`
  //     assert.strictEqual(result, expected)
  //   })
  //   test('toc editor handle error message', async () => {
  //     await withPanelFromCommand(OpenstaxCommand.SHOW_TOC_EDITOR, async (panel) => {
  //       const handler = tocEditorHandleMessage(panel, createMockClient())
  //       await assert.rejects(async () => await handler({ type: 'error', message: 'test' }))
  //     })
  //   }).timeout(5000)
  //   test('toc editor handle unexpected message', async () => {
  //     await withPanelFromCommand(OpenstaxCommand.SHOW_TOC_EDITOR, async (panel) => {
  //       const handler = tocEditorHandleMessage(panel, createMockClient())
  //       await assert.rejects(async () => await handler({ type: 'foo' } as unknown as TocPanelIncomingMessage))
  //     })
  //   }).timeout(5000)
  //   test('toc editor handle subcollection create', async () => {
  //     await withPanelFromCommand(OpenstaxCommand.SHOW_TOC_EDITOR, async (panel) => {
  //       const handler = tocEditorHandleMessage(panel, createMockClient())
  //       await handler({ type: 'subcollection-create', slug: 'test' })
  //     })
  //     const uri = expect(getRootPathUri())
  //     const collectionPath = path.join(uri.fsPath, 'collections', 'test.collection.xml')
  //     const collectionData = fs.readFileSync(collectionPath, { encoding: 'utf-8' })
  //     const document = new DOMParser().parseFromString(collectionData)
  //     const newSubcollection = select('/col:collection/col:content/col:subcollection[2]/md:title', document) as Node[]
  //     assert.notStrictEqual(newSubcollection, undefined)
  //     assert.notStrictEqual(newSubcollection, null)
  //     assert.strictEqual(newSubcollection.length, 1)
  //     assert.strictEqual(newSubcollection[0].textContent, 'New Subcollection')
  //   })
  //   test('toc editor handle module create', async () => {
  //     await withPanelFromCommand(OpenstaxCommand.SHOW_TOC_EDITOR, async (panel) => {
  //       const handler = tocEditorHandleMessage(panel, createMockClient())
  //       await handler({ type: 'PAGE_CREATE' })
  //     })
  //     const uri = expect(getRootPathUri())
  //     const modulePath = path.join(uri.fsPath, 'modules', 'm00004', 'index.cnxml')
  //     assert(fs.existsSync(modulePath))
  //     const moduleData = fs.readFileSync(modulePath, { encoding: 'utf-8' })
  //     const document = new DOMParser().parseFromString(moduleData)
  //     const moduleTitle = select('//md:title', document) as Node[]
  //     assert.strictEqual(moduleTitle.length, 1)
  //     assert.strictEqual(moduleTitle[0].textContent, 'New Module')
  //     const moduleId = select('//md:content-id', document) as Node[]
  //     assert.strictEqual(moduleId.length, 1)
  //     assert.strictEqual(moduleId[0].textContent, 'm00004')
  //     const moduleUUIDv4 = select('//md:uuid', document) as Node[]
  //     const uuidRgx = /^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/
  //     let uuidV4: any = null
  //     uuidV4 = moduleUUIDv4[0].textContent
  //     assert.strictEqual(moduleUUIDv4.length, 1)
  //     assert(uuidRgx.test(uuidV4))
  //   })
  //   test('toc editor handle module rename best case', async () => {
  //     await withPanelFromCommand(OpenstaxCommand.SHOW_TOC_EDITOR, async (panel) => {
  //       const handler = tocEditorHandleMessage(panel, createMockClient())
  //       await handler({ type: 'module-rename', moduleid: 'm00001', newName: 'rename' })
  //     })
  //     const uri = expect(getRootPathUri())
  //     const modulePath = path.join(uri.fsPath, 'modules', 'm00001', 'index.cnxml')
  //     const moduleData = fs.readFileSync(modulePath, { encoding: 'utf-8' })
  //     const document = new DOMParser().parseFromString(moduleData)
  //     const moduleMetaTitle = select('//cnxml:metadata/md:title', document) as Element[]
  //     const moduleTitle = select('//cnxml:title', document) as Element[]
  //     assert.strictEqual(moduleMetaTitle.length, 1)
  //     assert.strictEqual(moduleMetaTitle[0].textContent, 'rename')
  //     assert.strictEqual(moduleTitle.length, 1)
  //     assert.strictEqual(moduleTitle[0].textContent, 'rename')
  //   })
  //   test('toc editor handle module rename worst case', async () => {
  //     // The worst case scenario entails CNXML with no existing metadata or title,
  //     // so delete them from one of our test book modules prior to doing the
  //     // rename
  //     const uri = expect(getRootPathUri())
  //     const modulePath = path.join(uri.fsPath, 'modules', 'm00002', 'index.cnxml')
  //     let moduleData = fs.readFileSync(modulePath, { encoding: 'utf-8' })
  //     let document = new DOMParser().parseFromString(moduleData)
  //     const metadata = select('//cnxml:metadata', document) as Element[]
  //     metadata[0].parentNode?.removeChild(metadata[0])
  //     let moduleTitle = select('//cnxml:title', document) as Element[]
  //     moduleTitle[0].parentNode?.removeChild(moduleTitle[0])
  //     const modifiedModule = new XMLSerializer().serializeToString(document)
  //     fs.writeFileSync(modulePath, modifiedModule, { encoding: 'utf-8' })
  //     await withPanelFromCommand(OpenstaxCommand.SHOW_TOC_EDITOR, async (panel) => {
  //       const handler = tocEditorHandleMessage(panel, createMockClient())
  //       await handler({ type: 'module-rename', moduleid: 'm00002', newName: 'rename' })
  //     })
  //     moduleData = fs.readFileSync(modulePath, { encoding: 'utf-8' })
  //     document = new DOMParser().parseFromString(moduleData)
  //     const moduleMetaTitle = select('//cnxml:metadata/md:title', document) as Element[]
  //     moduleTitle = select('//cnxml:title', document) as Element[]
  //     assert.strictEqual(moduleMetaTitle.length, 1)
  //     assert.strictEqual(moduleMetaTitle[0].textContent, 'rename')
  //     assert.strictEqual(moduleTitle.length, 1)
  //     assert.strictEqual(moduleTitle[0].textContent, 'rename')
  //   })
  test('toc editor refreshes when server watched file changes', async () => {
    const mockEvents = createMockEvents()
    const watchedFilesSpy = sinon.spy(mockEvents.events, 'onDidChangeWatchedFiles')
    const panel = new TocEditorPanel({ bookTocs: DEFAULT_BOOK_TOCS_ARGS, resourceRootDir, client: createMockClient(), events: mockEvents.events })
    const refreshStub = sinon.stub(panel, 'refreshPanel')

    await watchedFilesSpy.getCall(0).args[0](undefined)
    assert(refreshStub.called)
  })
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
    const panel = new ImageManagerPanel({ bookTocs: DEFAULT_BOOK_TOCS_ARGS, resourceRootDir, client: createMockClient(), events: createMockEvents().events })
    await panel.handleMessage({ mediaUploads: [{ mediaName: 'urgent2.jpg', data: 'data:image/jpeg;base64,' + data }] })
    const uploaded = fs.readFileSync(path.join(TEST_DATA_DIR, 'media/urgent2.jpg'), { encoding: 'base64' })
    assert.strictEqual(data, uploaded)
  })
  test('image upload handle message ignore duplicate image', async () => {
    const data = fs.readFileSync(path.join(TEST_DATA_DIR, 'media/urgent.jpg'), { encoding: 'base64' })
    const panel = new ImageManagerPanel({ bookTocs: DEFAULT_BOOK_TOCS_ARGS, resourceRootDir, client: createMockClient(), events: createMockEvents().events })
    await panel.handleMessage({ mediaUploads: [{ mediaName: 'urgent.jpg', data: 'data:image/jpeg;base64,0' }] })
    const newData = fs.readFileSync(path.join(TEST_DATA_DIR, 'media/urgent.jpg'), { encoding: 'base64' })
    assert.strictEqual(data, newData)
  })
  test('raw text html content for webview use', () => {
    const content = 'test'
    assert.strictEqual(rawTextHtml(content), '<html><body>test</body></html>')
  })
  test('raw text html content for webview use disallows potential unsafe text', () => {
    const content = '<injected></injected>'
    assert.throws(() => { rawTextHtml(content) })
  })
  test('show cnxml preview with no file open', async () => {
    assert.strictEqual(vscode.window.activeTextEditor, undefined)
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
    const panel = new CnxmlPreviewPanel({ bookTocs: DEFAULT_BOOK_TOCS_ARGS, resourceRootDir, client: createMockClient(), events: createMockEvents().events })
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
    assert((panel.postMessage as SinonRoot.SinonSpy).calledWith({ type: 'refresh', xml: xmlExpectedSecond, xsl: xsl }))
    assert.strictEqual((panel as any).resourceBinding.fsPath, resourceSecond.fsPath)
  }).timeout(5000)
  test('cnxml preview only rebinds to cnxml', async () => {
    const uri = expect(getRootPathUri())
    const panel = new CnxmlPreviewPanel({ bookTocs: DEFAULT_BOOK_TOCS_ARGS, resourceRootDir, client: createMockClient(), events: createMockEvents().events })
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
    const panel = new CnxmlPreviewPanel({ bookTocs: DEFAULT_BOOK_TOCS_ARGS, resourceRootDir, client: createMockClient(), events: createMockEvents().events })
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
    const panel = new CnxmlPreviewPanel({ bookTocs: DEFAULT_BOOK_TOCS_ARGS, resourceRootDir, client: createMockClient(), events: createMockEvents().events })
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
    const panel = new CnxmlPreviewPanel({ bookTocs: DEFAULT_BOOK_TOCS_ARGS, resourceRootDir, client: createMockClient(), events: createMockEvents().events })
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
    const panel = new CnxmlPreviewPanel({ bookTocs: DEFAULT_BOOK_TOCS_ARGS, resourceRootDir, client: createMockClient(), events: createMockEvents().events })
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
    const panel = new CnxmlPreviewPanel({ bookTocs: DEFAULT_BOOK_TOCS_ARGS, resourceRootDir, client: createMockClient(), events: mockEvents.events })
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
    const panel = new CnxmlPreviewPanel({ bookTocs: DEFAULT_BOOK_TOCS_ARGS, resourceRootDir, client: createMockClient(), events: createMockEvents().events })
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
  test('schema files are populated when not existing', async () => {
    const uri = expect(getRootPathUri())
    const schemaPath = path.join(uri.path, '.xsd')
    assert(!fs.existsSync(schemaPath))
    await populateXsdSchemaFiles(TEST_OUT_DIR)
    assert(fs.existsSync(schemaPath))
    assert(fs.existsSync(path.join(schemaPath, 'catalog.xml')))
  })
  test('schema files are replaced when they exist', async () => {
    const uri = expect(getRootPathUri())
    const schemaPath = path.join(uri.path, '.xsd')
    const testXsdPath = path.join(schemaPath, 'foo.xsd')
    assert(!fs.existsSync(schemaPath))
    fs.mkdirSync(path.join(schemaPath))
    fs.writeFileSync(testXsdPath, 'test')
    assert(fs.existsSync(testXsdPath))
    await populateXsdSchemaFiles(TEST_OUT_DIR)
    assert(!fs.existsSync(testXsdPath))
  })
  test('schema-generation does not run when there is no workspace', async () => {
    sinon.stub(vscode.workspace, 'workspaceFolders').get(() => undefined)
    await populateXsdSchemaFiles('')
  })
  test('getErrorDiagnostics returns expected errors', async () => {
    const file1Uri = { path: '/test1.cnxml', scheme: 'file' } as any as vscode.Uri
    const file1Diag1 = { severity: vscode.DiagnosticSeverity.Error, source: 'source1' } as any as vscode.Diagnostic
    const file1Diag2 = { severity: vscode.DiagnosticSeverity.Error, source: 'source2' } as any as vscode.Diagnostic
    const file1Diag3 = { severity: vscode.DiagnosticSeverity.Warning, source: 'source2' } as any as vscode.Diagnostic
    const file2Uri = { path: '/test2.cnxml', scheme: 'file' } as any as vscode.Uri
    const file2Diag1 = { severity: vscode.DiagnosticSeverity.Error, source: 'source2' } as any as vscode.Diagnostic
    const file2Diag2 = { severity: vscode.DiagnosticSeverity.Error, source: undefined } as any as vscode.Diagnostic
    const testDiagnostics: Array<[vscode.Uri, vscode.Diagnostic[]]> = [
      [file1Uri, [file1Diag1, file1Diag2, file1Diag3]],
      [file2Uri, [file2Diag1, file2Diag2]]
    ]
    sinon.stub(vscode.languages, 'getDiagnostics').returns(testDiagnostics)
    const errorsBySource = getErrorDiagnosticsBySource()
    const expected = new Map<string, Array<[vscode.Uri, vscode.Diagnostic]>>()
    expected.set('source1', [[file1Uri, file1Diag1]])
    expected.set('source2', [[file1Uri, file1Diag2], [file2Uri, file2Diag1]])
    assert.deepStrictEqual(errorsBySource, expected)
  })
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
  test('TocTreesProvider returns expected TocTreeItems', async () => {
    const fakeTreeCollection: BookToc[] = []
    fakeTreeCollection.push(
      {
        type: BookRootNode.Singleton,
        title: 'Collection1',
        slug: 'collection1',
        uuid: '',
        language: '',
        licenseUrl: '',
        absPath: 'path/to/nowhere-book',
        tree: [{
          type: TocNodeKind.Inner,
          value: { token: 'id123', title: 'subcollection' },
          children: [{
            type: TocNodeKind.Leaf,
            value: {
              token: 'id234',
              absPath: 'path/to/nowhere',
              fileId: 'm00001',
              title: 'Module1'
            }
          },
          {
            type: TocNodeKind.Leaf,
            value: {
              token: 'id345',
              absPath: 'path/to/nowhere2',
              fileId: 'm00002',
              title: 'Module2'
            }
          }]
        }]
      },
      {
        type: BookRootNode.Singleton,
        title: 'Collection2',
        slug: 'collection2',
        uuid: '',
        language: '',
        licenseUrl: '',
        absPath: 'path/to/nowhere-book',
        tree: [{
          type: TocNodeKind.Leaf,
          value: {
            token: 'id123',
            absPath: 'path/to/nowhere3',
            fileId: 'm00003',
            title: 'Module3'
          }
        }]
      }
    )
    const fakeWorkspacePath = '/tmp/fakeworkspace'
    sinon.stub(utils, 'getRootPathUri').returns(vscode.Uri.file(fakeWorkspacePath))
    const module1Item = new TocTreeItem(
      TocItemIcon.Page,
      'Module1',
      vscode.TreeItemCollapsibleState.None,
      [],
      {
        title: 'open',
        command: 'vscode.open',
        arguments: [vscode.Uri.file(`${fakeWorkspacePath}/modules/m00001/index.cnxml`)]
      },
      'm00001'
    )
    const module2Item = new TocTreeItem(
      TocItemIcon.Page,
      'Module2',
      vscode.TreeItemCollapsibleState.None,
      [],
      {
        title: 'open',
        command: 'vscode.open',
        arguments: [vscode.Uri.file(`${fakeWorkspacePath}/modules/m00002/index.cnxml`)]
      },
      'm00002'
    )
    const module3Item = new TocTreeItem(
      TocItemIcon.Page,
      'Module3',
      vscode.TreeItemCollapsibleState.None,
      [],
      {
        title: 'open',
        command: 'vscode.open',
        arguments: [vscode.Uri.file(`${fakeWorkspacePath}/modules/m00003/index.cnxml`)]
      },
      'm00003'
    )
    const module3ItemToggled = new TocTreeItem(
      TocItemIcon.Page,
      'Module3 (m00003)',
      vscode.TreeItemCollapsibleState.None,
      [],
      {
        title: 'open',
        command: 'vscode.open',
        arguments: [vscode.Uri.file(`${fakeWorkspacePath}/modules/m00003/index.cnxml`)]
      },
      undefined
    )
    const subcollectionItem = new TocTreeItem(
      TocItemIcon.SubBook,
      'subcollection',
      vscode.TreeItemCollapsibleState.Collapsed,
      [module1Item, module2Item]
    )
    const collection1Item = new TocTreeItem(
      TocItemIcon.Book,
      'Collection1',
      vscode.TreeItemCollapsibleState.Collapsed,
      [subcollectionItem],
      {
        title: 'open',
        command: 'vscode.open',
        arguments: [vscode.Uri.file(`${fakeWorkspacePath}/collections/collection1.collection.xml`)]
      }
    )
    const collection2Item = new TocTreeItem(
      TocItemIcon.Book,
      'Collection2',
      vscode.TreeItemCollapsibleState.Collapsed,
      [module3Item],
      {
        title: 'open',
        command: 'vscode.open',
        arguments: [vscode.Uri.file(`${fakeWorkspacePath}/collections/collection2.collection.xml`)]
      }
    )

    const mockClient = createMockClient()
    // We don't want to just return []
    const sendRequestMock = sinon.stub()
    mockClient.sendRequest = sendRequestMock
    const tocTreesProvider = new TocTreesProvider({ bookTocs: DEFAULT_BOOK_TOCS_ARGS, resourceRootDir, client: mockClient, events: createMockEvents().events })
    sendRequestMock.onCall(0).resolves(null)
    sendRequestMock.onCall(1).resolves(fakeTreeCollection)

    assert.deepStrictEqual(await tocTreesProvider.getChildren(undefined), [])
    assert.deepStrictEqual(await tocTreesProvider.getChildren(undefined), [collection1Item, collection2Item])
    assert.deepStrictEqual(await tocTreesProvider.getChildren(collection2Item), [module3Item])
    assert.deepStrictEqual(tocTreesProvider.getTreeItem(collection2Item), collection2Item)
    assert.deepStrictEqual(tocTreesProvider.getParent(collection2Item), undefined)
    assert.deepStrictEqual(tocTreesProvider.getParent(module3Item), collection2Item)
    assert.deepStrictEqual(tocTreesProvider.getParent(module1Item), subcollectionItem)
    tocTreesProvider.toggleFilterMode()
    assert.deepStrictEqual(tocTreesProvider.getTreeItem(module3Item), module3ItemToggled)
  })
  test('toggleTocTreesFilteringHandler', async () => {
    const revealStub = sinon.stub()
    const toggleFilterStub = sinon.stub()
    const getChildrenStub = sinon.stub()
    const refreshStub = sinon.stub()

    const view: vscode.TreeView<BookOrTocNode> = {
      reveal: revealStub
    } as unknown as vscode.TreeView<BookOrTocNode>
    const provider: TocsTreeProvider = {
      toggleFilterMode: toggleFilterStub,
      getChildren: getChildrenStub,
      refresh: refreshStub
    } as unknown as TocsTreeProvider
    const fakeChildren = [
      { label: 'col1', children: [{ label: 'subcol', children: [{ label: 'm2', children: [] }] }] },
      { label: 'col2', children: [{ label: 'm1', children: [] }] }
    ]
    getChildrenStub.resolves(fakeChildren)

    const handler = toggleTocTreesFilteringHandler(view, provider)
    await handler()
    assert(toggleFilterStub.calledOnce)
    assert(getChildrenStub.calledOnce)
    assert(revealStub.calledThrice)
    assert(revealStub.calledWith(fakeChildren[0], { expand: true }))
    assert(revealStub.calledWith(fakeChildren[0].children[0], { expand: true }))
    assert(revealStub.calledWith(fakeChildren[1], { expand: true }))
    assert(refreshStub.notCalled)
  })
  test('toggleTocTreesFilteringHandler disables itself while revealing', async () => {
    const revealStub = sinon.stub()
    const toggleFilterStub = sinon.stub()
    const getChildrenStub = sinon.stub()
    const fakeChildren = [
      { label: 'col1', children: [{ label: 'm1', children: [] }] }
    ]
    getChildrenStub.resolves(fakeChildren)

    const view: vscode.TreeView<BookOrTocNode> = {
      reveal: revealStub
    } as unknown as vscode.TreeView<BookOrTocNode>
    const provider: TocsTreeProvider = {
      toggleFilterMode: toggleFilterStub,
      getChildren: getChildrenStub
    } as unknown as TocsTreeProvider

    const handler = toggleTocTreesFilteringHandler(view, provider)
    // Invoke the handler the first time reveal is called to simulate a parallel
    // user request without resorting to synthetic delay injection
    revealStub.onCall(0).callsFake(handler)
    await handler()
    assert(toggleFilterStub.calledOnce)
    assert(revealStub.calledOnce)
    assert(getChildrenStub.calledOnce)
  })
  test('toggleTocTreesFilteringHandler doesn\'t lock itself on errors', async () => {
    const toggleFilterStub = sinon.stub().throws()
    const view: vscode.TreeView<BookOrTocNode> = {} as unknown as vscode.TreeView<BookOrTocNode>
    const provider: TocsTreeProvider = {
      toggleFilterMode: toggleFilterStub
    } as unknown as TocsTreeProvider

    const handler = toggleTocTreesFilteringHandler(view, provider)
    try { await handler() } catch { }
    try { await handler() } catch { }
    assert(toggleFilterStub.calledTwice)
  })
  test('TocTreesProvider fires event on refresh', async () => {
    const tocTreesProvider = new TocTreesProvider({ bookTocs: DEFAULT_BOOK_TOCS_ARGS, resourceRootDir, client: createMockClient(), events: createMockEvents().events })
    const eventFire = sinon.stub((tocTreesProvider as any)._onDidChangeTreeData, 'fire')
    tocTreesProvider.refresh()
    assert(eventFire.calledOnce)
  })
  test('TocTreesProvider calls refresh when toggling filter mode', async () => {
    const tocTreesProvider = new TocTreesProvider({ bookTocs: DEFAULT_BOOK_TOCS_ARGS, resourceRootDir, client: createMockClient(), events: createMockEvents().events })
    const refresh = sinon.stub(tocTreesProvider, 'refresh')
    tocTreesProvider.toggleFilterMode()
    assert(refresh.calledOnce)
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
  class TestPanel extends Panel<void, void> {
    constructor(private readonly context: ExtensionHostContext) {
      super(initTestPanel(context))
    }

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
    const panel = new TestPanel({ bookTocs: DEFAULT_BOOK_TOCS_ARGS, resourceRootDir, client: createMockClient(), events: createMockEvents().events })
    const panelDisposed = new Promise((resolve, reject) => {
      panel.onDidDispose(() => {
        resolve(true)
      })
    })
    panel.dispose()
    assert(await panelDisposed)
  })
  test('disposed panels may not post messages', async () => {
    const panel = new TestPanel({ bookTocs: DEFAULT_BOOK_TOCS_ARGS, resourceRootDir, client: createMockClient(), events: createMockEvents().events })
    const postStub = sinon.stub((panel as any).panel.webview, 'postMessage').rejects()
    panel.dispose()
    await panel.postMessage(undefined)
    assert(postStub.notCalled)
  })
  test('registered disposables disposed upon parent disposal', async () => {
    const panel = new TestPanel({ bookTocs: DEFAULT_BOOK_TOCS_ARGS, resourceRootDir, client: createMockClient(), events: createMockEvents().events })
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
    const panel = new TestPanel({ bookTocs: DEFAULT_BOOK_TOCS_ARGS, resourceRootDir, client: createMockClient(), events: createMockEvents().events })
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
})
