import assert from 'assert'
import fs from 'fs-extra'
import path from 'path'
import vscode from 'vscode'
import SinonRoot from 'sinon'
import { GitErrorCodes, Repository, CommitOptions, RepositoryState, Branch } from '../../git-api/git.d'
import 'source-map-support/register'
import {
  expect as expectOrig, ensureCatch, getRootPathUri,
  fixResourceReferences, fixCspSourceReferences, addBaseHref, populateXsdSchemaFiles,
  getErrorDiagnosticsBySource,
  ensureCatchPromise
} from './../../utils'
import { activate, deactivate, forwardOnDidChangeWorkspaceFolders } from './../../extension'
import {
  handleMessageFromWebviewPanel as tocEditorHandleMessage,
  NS_CNXML, NS_COLLECTION, NS_METADATA,
  PanelIncomingMessage as TocPanelIncomingMessage, TocEditorPanel
} from './../../panel-toc-editor'
import { ImageManagerPanel } from './../../panel-image-manager'
import { CnxmlPreviewPanel, rawTextHtml, tagElementsWithLineNumbers } from './../../panel-cnxml-preview'
import { TocTreeCollection } from '../../../../common/src/toc-tree'
import { OpenstaxCommand } from '../../extension-types'
import * as pushContent from '../../push-content'
import { Suite } from 'mocha'
import { DOMParser, XMLSerializer } from 'xmldom'
import * as xpath from 'xpath-ts'
import { Substitute } from '@fluffy-spoon/substitute'
import { LanguageClient } from 'vscode-languageclient/node'
import { ExtensionServerRequest } from '../../../../common/src/requests'
import { Disposer, ExtensionHostContext, Panel } from '../../panel'

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
    onRequest: SinonRoot.stub().returns({ dispose: () => {} })
  } as unknown as LanguageClient
}

const extensionExports = activate(contextStub as any)

async function sleep(ms: number): Promise<void> {
  return await new Promise(resolve => setTimeout(resolve, ms))
}

function expect<T>(value: T | null | undefined): T {
  return expectOrig(value, 'test_assertion')
}

const select = xpath.useNamespaces({ cnxml: NS_CNXML, col: NS_COLLECTION, md: NS_METADATA })

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
  fs.rmdirSync(TEST_DATA_DIR, { recursive: true })
  fs.mkdirpSync(TEST_DATA_DIR)
  fs.copySync(path.join(ORIGIN_DATA_DIR, 'collections'), path.join(TEST_DATA_DIR, 'collections'))
  fs.copySync(path.join(ORIGIN_DATA_DIR, 'media'), path.join(TEST_DATA_DIR, 'media'))
  fs.copySync(path.join(ORIGIN_DATA_DIR, 'modules'), path.join(TEST_DATA_DIR, 'modules'))
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
        assert(modified.includes('vscode-webview-resource'))
      }
    )
  })
  test('fixResourceReferences relative', () => {
    const html = '<document><a href="./media/some-image.jpg"></a></document>'
    withTestPanel(
      html,
      (panel) => {
        const modified = fixResourceReferences(panel.webview, html, TEST_DATA_DIR)
        assert(modified.includes('vscode-webview-resource'))
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
        assert(modified.includes('vscode-webview-resource'))
      }
    )
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
  test('toc editor refresh makes proper language server requests', async () => {
    const mockClient = createMockClient()
    const panel = new TocEditorPanel({ resourceRootDir, client: mockClient })
    await panel.handleMessage({ type: 'refresh' })
    const expectedCalls = [
      [ExtensionServerRequest.BundleTrees, { workspaceUri: `file://${TEST_DATA_DIR}` }],
      [ExtensionServerRequest.BundleModules, { workspaceUri: `file://${TEST_DATA_DIR}` }],
      [ExtensionServerRequest.BundleOrphanedModules, { workspaceUri: `file://${TEST_DATA_DIR}` }]
    ]
    assert.strictEqual((mockClient.sendRequest as SinonRoot.SinonStub).getCalls().length, 3)
    for (const args of expectedCalls) {
      assert((mockClient.sendRequest as SinonRoot.SinonStub).calledWith(...args))
    }
  }).timeout(5000)
  test('toc editor refresh makes no request when disposed', async () => {
    const mockClient = createMockClient()
    const panel = new TocEditorPanel({ resourceRootDir, client: mockClient })
    panel.dispose()
    await panel.handleMessage({ type: 'refresh' })
    assert((mockClient.sendRequest as SinonRoot.SinonStub).notCalled)
  })
  test('toc editor handle data message', async () => {
    const uri = expect(getRootPathUri())
    const collectionPath = path.join(uri.fsPath, 'collections', 'test.collection.xml')
    const before = fs.readFileSync(collectionPath)
    const mockEditAddModule: TocTreeCollection = {
      type: 'collection',
      title: 'test collection',
      slug: 'test',
      children: [{
        type: 'subcollection',
        title: 'subcollection',
        children: [{
          type: 'module',
          moduleid: 'm00001',
          title: 'Introduction'
        }]
      }, {
        type: 'module',
        moduleid: 'm00002',
        title: 'Unnamed Module'
      }]
    }
    await withPanelFromCommand(OpenstaxCommand.SHOW_TOC_EDITOR, async (panel) => {
      const handler = tocEditorHandleMessage(panel, createMockClient())
      await handler({ type: 'write-tree', treeData: mockEditAddModule })
    })
    const after = fs.readFileSync(collectionPath, { encoding: 'utf-8' })
    assert.strictEqual(before.indexOf('m00002'), -1)
    assert.notStrictEqual(after.indexOf('m00002'), -1)
  }).timeout(5000)
  test('toc editor handle error message', async () => {
    await withPanelFromCommand(OpenstaxCommand.SHOW_TOC_EDITOR, async (panel) => {
      const handler = tocEditorHandleMessage(panel, createMockClient())
      await assert.rejects(async () => await handler({ type: 'error', message: 'test' }))
    })
  }).timeout(5000)
  test('toc editor handle unexpected message', async () => {
    await withPanelFromCommand(OpenstaxCommand.SHOW_TOC_EDITOR, async (panel) => {
      const handler = tocEditorHandleMessage(panel, createMockClient())
      await assert.rejects(async () => await handler({ type: 'foo' } as unknown as TocPanelIncomingMessage))
    })
  }).timeout(5000)
  test('toc editor handle subcollection create', async () => {
    await withPanelFromCommand(OpenstaxCommand.SHOW_TOC_EDITOR, async (panel) => {
      const handler = tocEditorHandleMessage(panel, createMockClient())
      await handler({ type: 'subcollection-create', slug: 'test' })
    })
    const uri = expect(getRootPathUri())
    const collectionPath = path.join(uri.fsPath, 'collections', 'test.collection.xml')
    const collectionData = fs.readFileSync(collectionPath, { encoding: 'utf-8' })
    const document = new DOMParser().parseFromString(collectionData)
    const newSubcollection = select('/col:collection/col:content/col:subcollection[2]/md:title', document) as Node[]
    assert.notStrictEqual(newSubcollection, undefined)
    assert.notStrictEqual(newSubcollection, null)
    assert.strictEqual(newSubcollection.length, 1)
    assert.strictEqual(newSubcollection[0].textContent, 'New Subcollection')
  })
  test('toc editor handle module create', async () => {
    await withPanelFromCommand(OpenstaxCommand.SHOW_TOC_EDITOR, async (panel) => {
      const handler = tocEditorHandleMessage(panel, createMockClient())
      await handler({ type: 'module-create' })
    })
    const uri = expect(getRootPathUri())
    const modulePath = path.join(uri.fsPath, 'modules', 'm00004', 'index.cnxml')
    assert(fs.existsSync(modulePath))
    const moduleData = fs.readFileSync(modulePath, { encoding: 'utf-8' })
    const document = new DOMParser().parseFromString(moduleData)
    const moduleTitle = select('//md:title', document) as Node[]
    assert.strictEqual(moduleTitle.length, 1)
    assert.strictEqual(moduleTitle[0].textContent, 'New Module')
  })
  test('toc editor handle module rename best case', async () => {
    await withPanelFromCommand(OpenstaxCommand.SHOW_TOC_EDITOR, async (panel) => {
      const handler = tocEditorHandleMessage(panel, createMockClient())
      await handler({ type: 'module-rename', moduleid: 'm00001', newName: 'rename' })
    })
    const uri = expect(getRootPathUri())
    const modulePath = path.join(uri.fsPath, 'modules', 'm00001', 'index.cnxml')
    const moduleData = fs.readFileSync(modulePath, { encoding: 'utf-8' })
    const document = new DOMParser().parseFromString(moduleData)
    const moduleTitle = select('//cnxml:metadata/md:title', document) as Node[]
    assert.strictEqual(moduleTitle.length, 1)
    assert.strictEqual(moduleTitle[0].textContent, 'rename')
  })
  test('toc editor handle module rename worst case', async () => {
    await withPanelFromCommand(OpenstaxCommand.SHOW_TOC_EDITOR, async (panel) => {
      const handler = tocEditorHandleMessage(panel, createMockClient())
      await handler({ type: 'module-rename', moduleid: 'm00002', newName: 'rename' })
    })
    const uri = expect(getRootPathUri())
    const modulePath = path.join(uri.fsPath, 'modules', 'm00002', 'index.cnxml')
    const moduleData = fs.readFileSync(modulePath, { encoding: 'utf-8' })
    const document = new DOMParser().parseFromString(moduleData)
    const moduleTitle = select('//cnxml:metadata/md:title', document) as Node[]
    assert.strictEqual(moduleTitle.length, 1)
    assert.strictEqual(moduleTitle[0].textContent, 'rename')
  })
  test('toc editor refreshes when server watched file changes', async () => {
    const mockClient = createMockClient()
    const panel = new TocEditorPanel({ resourceRootDir, client: mockClient })
    const refreshStub = sinon.stub(panel, 'refreshPanel')

    assert.strictEqual((mockClient.onRequest as SinonRoot.SinonStub).getCall(0).args[0], 'onDidChangeWatchedFiles')
    await (mockClient.onRequest as SinonRoot.SinonStub).getCall(0).args[1]()
    assert((refreshStub as SinonRoot.SinonStub).called)
  })
  test('show image upload', async () => {
    await withPanelFromCommand(OpenstaxCommand.SHOW_IMAGE_MANAGER, async (panel) => {
      const html = panel.webview.html
      assert.notStrictEqual(html, null)
      assert.notStrictEqual(html, undefined)
      assert.notStrictEqual(html.indexOf('html'), -1)
    })
  }).timeout(5000)
  test('image upload handle message', async () => {
    const data = fs.readFileSync(path.join(TEST_DATA_DIR, 'media/urgent.jpg'), { encoding: 'base64' })
    const panel = new ImageManagerPanel({ resourceRootDir, client: createMockClient() })
    await panel.handleMessage({ mediaUploads: [{ mediaName: 'urgent2.jpg', data: 'data:image/jpeg;base64,' + data }] })
    const uploaded = fs.readFileSync(path.join(TEST_DATA_DIR, 'media/urgent2.jpg'), { encoding: 'base64' })
    assert.strictEqual(data, uploaded)
  })
  test('image upload handle message ignore duplicate image', async () => {
    const data = fs.readFileSync(path.join(TEST_DATA_DIR, 'media/urgent.jpg'), { encoding: 'base64' })
    const panel = new ImageManagerPanel({ resourceRootDir, client: createMockClient() })
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
  test('cnxml preview handle message', async () => {
    const uri = expect(getRootPathUri())
    const resource = uri.with({ path: path.join(uri.path, 'modules', 'm00001', 'index.cnxml') })
    const document = await vscode.workspace.openTextDocument(resource)
    await vscode.window.showTextDocument(document)
    const before = document.getText()
    const testData = '<document>Test</document>'
    const panel = new CnxmlPreviewPanel({ resourceRootDir, client: createMockClient() })
    await panel.handleMessage({ type: 'direct-edit', xml: testData })
    const modified = document.getText()
    assert.strictEqual(modified, testData)
    assert.notStrictEqual(modified, before)
  })
  test('cnxml preview rebinds to resource in the active editor', async () => {
    const uri = expect(getRootPathUri())
    const panel = new CnxmlPreviewPanel({ resourceRootDir, client: createMockClient() })
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
    assert((panel.postMessage as SinonRoot.SinonSpy).calledWith({ type: 'refresh', xml: xmlExpectedFirst }))
    assert.strictEqual((panel as any).resourceBinding.fsPath, resourceFirst.fsPath)

    const documentSecond = await vscode.workspace.openTextDocument(resourceSecond)
    await vscode.window.showTextDocument(documentSecond, vscode.ViewColumn.Two)
    const contentFromFsBecauseVscodeLiesAboutDocumentContentSecond = await fs.promises.readFile(resourceSecond.fsPath, { encoding: 'utf-8' })
    const documentDomSecond = new DOMParser().parseFromString(contentFromFsBecauseVscodeLiesAboutDocumentContentSecond)
    tagElementsWithLineNumbers(documentDomSecond)
    const xmlExpectedSecond = new XMLSerializer().serializeToString(documentDomSecond)
    await resourceBindingChangedExpectedSecond
    assert((panel.postMessage as SinonRoot.SinonSpy).calledWith({ type: 'refresh', xml: xmlExpectedSecond }))
    assert.strictEqual((panel as any).resourceBinding.fsPath, resourceSecond.fsPath)
  })
  test('cnxml preview only rebinds to cnxml', async () => {
    const uri = expect(getRootPathUri())
    const panel = new CnxmlPreviewPanel({ resourceRootDir, client: createMockClient() })

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

    assert((panel.postMessage as SinonRoot.SinonSpy).calledWith({ type: 'refresh', xml: xmlExpectedFirst }))
    const refreshCalls = (panel.postMessage as SinonRoot.SinonSpy)
      .getCalls()
      .filter(call => call.args.some(arg => arg.type != null && arg.type === 'refresh'))
    assert.strictEqual(refreshCalls.length, 1)
    assert.strictEqual((panel as any).resourceBinding.fsPath, resourceFirst.fsPath)
  })
  test('cnxml preview refuses refresh if no resource bound', async () => {
    const panel = new CnxmlPreviewPanel({ resourceRootDir, client: createMockClient() })
    assert(panel.isPreviewOf(null))
    await (panel as any).refreshContents()
    const refreshCalls = (panel.postMessage as SinonRoot.SinonSpy)
      .getCalls()
      .filter(call => call.args.some(arg => arg.type != null && arg.type === 'refresh'))
    assert.strictEqual(refreshCalls.length, 0)
  })
  test('cnxml preview refuses edits if no resource bound', async () => {
    const uri = expect(getRootPathUri())
    const resource = uri.with({ path: path.join(uri.path, 'modules', 'm00001', 'index.cnxml') })
    const document = await vscode.workspace.openTextDocument(resource)
    await vscode.window.showTextDocument(document)
    const before = document.getText()
    const testData = '<document>Test</document>'
    const panel = new CnxmlPreviewPanel({ resourceRootDir, client: createMockClient() })
    const resourceBindingChangedExpected: Promise<vscode.Uri | null> = new Promise((resolve, reject) => {
      panel.onDidChangeResourceBinding((event) => {
        if (event != null && event.fsPath === resource.fsPath) {
          resolve(event)
        }
      })
    })
    await resourceBindingChangedExpected;
    (panel as any).resourceBinding = null
    await panel.handleMessage({ type: 'direct-edit', xml: testData })
    const modified = document.getText()
    assert.strictEqual(modified, before)
    assert.notStrictEqual(modified, testData)
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
    const panel = new CnxmlPreviewPanel({ resourceRootDir, client: createMockClient() })

    // reset revealed range
    const resetRange = new vscode.Range(0, 0, 1, 0)
    const resetStrategy = vscode.TextEditorRevealType.AtTop
    boundEditor.revealRange(resetRange, resetStrategy)
    unboundEditor.revealRange(resetRange, resetStrategy)

    await panel.handleMessage({ type: 'direct-edit', xml: testData })

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
    const panel = new CnxmlPreviewPanel({ resourceRootDir, client: createMockClient() })

    // reset revealed range
    const range = new vscode.Range(0, 0, 1, 0)
    const strategy = vscode.TextEditorRevealType.AtTop
    boundEditor.revealRange(range, strategy)
    unboundEditor.revealRange(range, strategy)

    const documentContentChanged = new Promise((resolve, reject) => {
      vscode.workspace.onDidChangeTextDocument((event) => {
        for (const change of event.contentChanges) {
          if (change.text == testData) {
            resolve(undefined)
          }
        }
      })
    })
    await panel.handleMessage({ type: 'direct-edit', xml: testData })
    await documentContentChanged;
    // ensure scrollable
    (panel as any).resourceIsScrolling = false
    const visualRangeChanged = new Promise((resolve, reject) => {
      vscode.window.onDidChangeTextEditorVisibleRanges(() => { resolve(undefined) })
    })
    await panel.handleMessage({ type: 'scroll-in-editor', line: 101 })
    await visualRangeChanged
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
    const panel = new CnxmlPreviewPanel({ resourceRootDir, client: createMockClient() })
    const boundEditor = expect(vscode.window.visibleTextEditors.find(editor => panel.isPreviewOf(editor.document.uri)))

    // reset revealed range
    const range = new vscode.Range(0, 0, 1, 0)
    const strategy = vscode.TextEditorRevealType.AtTop
    boundEditor.revealRange(range, strategy)

    await panel.handleMessage({ type: 'direct-edit', xml: testData });
    // editor is scrolling
    (panel as any).resourceIsScrolling = true
    await panel.handleMessage({ type: 'scroll-in-editor', line: 101 })

    const firstVisiblePosition = boundEditor.visibleRanges[0].start
    const lineNumber = firstVisiblePosition.line
    assert.strictEqual((panel as any).resourceBinding.fsPath, resource.fsPath)
    assert.strictEqual(lineNumber, 0)
  })
  test('cnxml preview refreshes when server watched file changes', async () => {
    const mockClient = createMockClient()
    const panel = new CnxmlPreviewPanel({ resourceRootDir, client: mockClient })
    sinon.stub(panel as any, 'refreshContents')
    const panelBindingChanged = new Promise((resolve, reject) => {
      panel.onDidChangeResourceBinding(() => resolve(undefined))
    })
    await panelBindingChanged
    const refreshCount = ((panel as any).refreshContents as SinonRoot.SinonStub).callCount
    assert.strictEqual((mockClient.onRequest as SinonRoot.SinonStub).getCall(0).args[0], 'onDidChangeWatchedFiles')
    await (mockClient.onRequest as SinonRoot.SinonStub).getCall(0).args[1]()
    assert.strictEqual(((panel as any).refreshContents as SinonRoot.SinonStub).callCount, refreshCount + 1)
  })
  test('cnxml preview throws upon unexpected message', async () => {
    const panel = new CnxmlPreviewPanel({ resourceRootDir, client: createMockClient() })
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
    populateXsdSchemaFiles(TEST_OUT_DIR)
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
    populateXsdSchemaFiles(TEST_OUT_DIR)
    assert(!fs.existsSync(testXsdPath))
  })
  test('schema-generation does not run when there is no workspace', async () => {
    sinon.stub(vscode.workspace, 'workspaceFolders').get(() => undefined)
    populateXsdSchemaFiles('')
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
      source: pushContent.DiagnosticSource.cnxml
    } as any as vscode.Diagnostic
    const xmlError = {
      severity: vscode.DiagnosticSeverity.Error,
      source: pushContent.DiagnosticSource.xml
    } as any as vscode.Diagnostic
    const errorsBySource = new Map<string, Array<[vscode.Uri, vscode.Diagnostic]>>()
    const showErrorMsgStub = sinon.stub(vscode.window, 'showErrorMessage')

    // No errors
    assert(await pushContent.canPush(errorsBySource))

    // CNXML errors
    errorsBySource.set(pushContent.DiagnosticSource.cnxml, [[fileUri, cnxmlError]])
    assert(!(await pushContent.canPush(errorsBySource)))
    assert(showErrorMsgStub.calledOnceWith(pushContent.PushValidationModal.cnxmlErrorMsg, { modal: true }))

    // Both CNXML and XML errors
    errorsBySource.clear()
    showErrorMsgStub.reset()
    errorsBySource.set(pushContent.DiagnosticSource.cnxml, [[fileUri, cnxmlError]])
    errorsBySource.set(pushContent.DiagnosticSource.xml, [[fileUri, xmlError]])
    assert(!(await pushContent.canPush(errorsBySource)))
    assert(showErrorMsgStub.calledOnceWith(pushContent.PushValidationModal.cnxmlErrorMsg, { modal: true }))

    // XML errors, user cancels
    errorsBySource.clear()
    showErrorMsgStub.reset()
    showErrorMsgStub.returns(Promise.resolve(undefined))
    errorsBySource.set(pushContent.DiagnosticSource.xml, [[fileUri, xmlError]])
    assert(!(await pushContent.canPush(errorsBySource)))
    assert(showErrorMsgStub.calledOnceWith(pushContent.PushValidationModal.xmlErrorMsg, { modal: true }))

    // XML errors, user overrides
    errorsBySource.clear()
    showErrorMsgStub.reset()
    showErrorMsgStub.returns(Promise.resolve(pushContent.PushValidationModal.xmlErrorIgnoreItem as any as vscode.MessageItem))
    errorsBySource.set(pushContent.DiagnosticSource.xml, [[fileUri, xmlError]])
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
  const initTestPanel = (_context: ExtensionHostContext) => () => {
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
    const panel = new TestPanel({ resourceRootDir, client: createMockClient() })
    const panelDisposed = new Promise((resolve, reject) => {
      panel.onDidDispose(() => {
        resolve(true)
      })
    })
    panel.dispose()
    assert(await panelDisposed)
  })
  test('registered disposables disposed upon parent disposal', async () => {
    const panel = new TestPanel({ resourceRootDir, client: createMockClient() })
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
    const panel = new TestPanel({ resourceRootDir, client: createMockClient() })
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
const ignore = async (msg: string): Promise<string | undefined> => { return undefined }
const makeCaptureMessage = (messages: string[]): (msg: string) => Promise<string | undefined> => {
  const captureMessage = async (msg: string): Promise<string | undefined> => {
    messages.push(msg)
    return undefined
  }
  return captureMessage
}
const commitOptions: CommitOptions = { all: true }

suite('Push Button Test Suite', function (this: Suite) {
  const sinon = SinonRoot.createSandbox()
  this.afterEach(() => sinon.restore())

  test('getRepo returns repository', async () => {
    const repo = pushContent.getRepo()
    assert.notStrictEqual(repo.rootUri, undefined)
  })
  test('push with no conflict', async () => {
    const messages: string[] = []
    const captureMessage = makeCaptureMessage(messages)

    const getRepo = (): Repository => {
      const stubRepo = Substitute.for<Repository>()

      stubRepo.commit('poet commit', commitOptions).resolves()
      stubRepo.pull().resolves()
      stubRepo.push().resolves()

      return stubRepo
    }

    await assert.doesNotReject(pushContent._pushContent(getRepo, captureMessage, ignore)())
    assert.strictEqual(messages.length, 1)
    assert.strictEqual(messages[0], 'Successful content push.')
  })
  test('push with merge conflict', async () => {
    const messages: string[] = []
    const captureMessage = makeCaptureMessage(messages)
    const error: any = { _fake: 'FakeSoStackTraceIsNotInConsole', message: '' }

    error.gitErrorCode = GitErrorCodes.Conflict

    const getRepo = (): Repository => {
      const stubRepo = Substitute.for<Repository>()

      stubRepo.commit('poet commit', commitOptions).resolves()
      stubRepo.pull().rejects(error)
      stubRepo.push().resolves()

      return stubRepo
    }

    await assert.doesNotReject(pushContent._pushContent(getRepo, ignore, captureMessage)())
    assert.strictEqual(messages.length, 1)
    assert.strictEqual(messages[0], 'Content conflict, please resolve.')
  })
  test('unknown commit error', async () => {
    const messages: string[] = []
    const captureMessage = makeCaptureMessage(messages)
    const error: any = { _fake: 'FakeSoStackTraceIsNotInConsole', message: '' }

    error.gitErrorCode = ''

    const getRepo = (): Repository => {
      const stubRepo = Substitute.for<Repository>()

      stubRepo.commit('poet commit', commitOptions).resolves()
      stubRepo.pull().rejects(error)
      stubRepo.push().resolves()

      return stubRepo
    }

    await assert.doesNotReject(pushContent._pushContent(getRepo, ignore, captureMessage)())
    assert.strictEqual(messages.length, 1)
    assert.strictEqual(messages[0], 'Push failed: ')
  })
  test('push with no changes', async () => {
    const messages: string[] = []
    const captureMessage = makeCaptureMessage(messages)
    const error: any = { _fake: 'FakeSoStackTraceIsNotInConsole', message: '' }

    error.stdout = 'nothing to commit.'

    const getRepo = (): Repository => {
      const stubRepo = Substitute.for<Repository>()

      stubRepo.commit('poet commit', commitOptions).rejects(error)
      stubRepo.pull().resolves()
      stubRepo.push().resolves()

      return stubRepo
    }

    await assert.doesNotReject(pushContent._pushContent(getRepo, ignore, captureMessage)())
    assert.strictEqual(messages.length, 1)
    assert.strictEqual(messages[0], 'No changes to push.')
  })
  test('unknown push error', async () => {
    const messages: string[] = []
    const captureMessage = makeCaptureMessage(messages)
    const error: any = { _fake: 'FakeSoStackTraceIsNotInConsole', message: '' }

    error.stdout = ''

    const getRepo = (): Repository => {
      const stubRepo = Substitute.for<Repository>()

      stubRepo.commit('poet commit', commitOptions).rejects(error)
      stubRepo.pull().resolves()
      stubRepo.push().resolves()

      return stubRepo
    }

    await assert.doesNotReject(pushContent._pushContent(getRepo, ignore, captureMessage)())
    assert.strictEqual(messages.length, 1)
    assert.strictEqual(messages[0], 'Push failed: ')
  })
  test('pushContent does not invoke _pushContent when canPush is false', async () => {
    sinon.stub(pushContent, 'canPush').resolves(false)
    const stubPushContentHelperInner = sinon.stub()
    sinon.stub(pushContent, '_pushContent').returns(stubPushContentHelperInner)
    await pushContent.pushContent()()
    assert(stubPushContentHelperInner.notCalled)
  })
  test('pushContent invokes _pushContent when canPush is true', async () => {
    sinon.stub(pushContent, 'canPush').resolves(true)
    const stubPushContentHelperInner = sinon.stub()
    sinon.stub(pushContent, '_pushContent').returns(stubPushContentHelperInner)
    await pushContent.pushContent()()
    assert(stubPushContentHelperInner.calledOnce)
  })
  test('push to new branch', async () => {
    const messages: string[] = []
    const captureMessage = makeCaptureMessage(messages)
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

    await assert.doesNotReject(pushContent._pushContent(getRepo, captureMessage, ignore)())
    assert.strictEqual(messages.length, 1)
    assert.strictEqual(messages[0], 'Successful content push.')
    assert(pushStub.calledOnceWith('origin', newBranchName, true))
  })
})
