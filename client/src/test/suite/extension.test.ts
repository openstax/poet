import assert from 'assert'
import fs from 'fs-extra'
import path from 'path'
import vscode from 'vscode'
import SinonRoot from 'sinon'
import { GitErrorCodes, Repository, CommitOptions, RepositoryState, Branch } from '../../git-api/git.d'
import 'source-map-support/register'
import {
  expect as expectOrig, ensureCatch, getRootPathUri, getLocalResourceRoots,
  fixResourceReferences, fixCspSourceReferences, addBaseHref, populateXsdSchemaFiles,
  getErrorDiagnosticsBySource
} from './../../utils'
import { activate, createLazyPanelOpener, deactivate, forwardOnDidChangeWorkspaceFolders, refreshTocPanel, invokeRefreshers } from './../../extension'
import { handleMessageFromWebviewPanel as tocEditorHandleMessage, NS_CNXML, NS_COLLECTION, NS_METADATA, PanelIncomingMessage as TocPanelIncomingMessage } from './../../panel-toc-editor'
import { handleMessage as imageUploadHandleMessage } from './../../panel-image-upload'
import { handleMessage as cnxmlPreviewHandleMessage } from './../../panel-cnxml-preview'
import { TocTreeCollection, TocTreeElementType } from '../../../../common/src/toc-tree'
import { commandToPanelType, OpenstaxCommand, PanelType } from '../../extension-types'
import * as pushContent from '../../push-content'
import { Suite } from 'mocha'
import { DOMParser } from 'xmldom'
import * as xpath from 'xpath-ts'
import { Substitute } from '@fluffy-spoon/substitute'
import { LanguageClient } from 'vscode-languageclient/node'
import { ExtensionServerRequest } from '../../../../common/src/requests'
import { TocTreesProvider, TocTreeItem, toggleTocTreesFilteringHandler } from './../../toc-trees'
import * as utils from './../../utils' // Used for dependency mocking in tests

// Test runs in out/client/src/test/suite, not src/client/src/test/suite
const ORIGIN_DATA_DIR = path.join(__dirname, '../../../../../../')
const TEST_DATA_DIR = path.join(__dirname, '../data/test-repo')
const TEST_OUT_DIR = path.join(__dirname, '../../')

const contextStub = {
  asAbsolutePath: (relPath: string) => path.resolve(__dirname, '../../../../../../', relPath)
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
  const panel = expect((await extensionExports).activePanelsByType[commandToPanelType[command]])
  await func(panel)
  panel.dispose()
}

const resetTestData = async (): Promise<void> => {
  await vscode.workspace.saveAll(true)
  fs.rmdirSync(TEST_DATA_DIR, { recursive: true })
  fs.mkdirpSync(TEST_DATA_DIR)
  fs.copySync(path.join(ORIGIN_DATA_DIR, 'collections'), path.join(TEST_DATA_DIR, 'collections'))
  fs.copySync(path.join(ORIGIN_DATA_DIR, 'media'), path.join(TEST_DATA_DIR, 'media'))
  fs.copySync(path.join(ORIGIN_DATA_DIR, 'modules'), path.join(TEST_DATA_DIR, 'modules'))
}

suite('Unsaved Files', function (this: Suite) {
  this.beforeEach(resetTestData)
  test('show cnxml preview with no file open', async () => {
    const activationExports = await extensionExports
    assert.strictEqual(vscode.window.activeTextEditor, undefined)
    await vscode.commands.executeCommand(OpenstaxCommand.SHOW_CNXML_PREVIEW)
    await sleep(1000) // Wait for panel to load
    const panel = activationExports.activePanelsByType[commandToPanelType[OpenstaxCommand.SHOW_CNXML_PREVIEW]]
    assert.strictEqual(panel, undefined)
  })
})

suite('Extension Test Suite', function (this: Suite) {
  const sinon = SinonRoot.createSandbox()
  this.beforeEach(resetTestData)
  this.afterEach(() => sinon.restore())

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
  test('getLocalResourceRoots', () => {
    const uri = expect(getRootPathUri())
    const roots = getLocalResourceRoots([], uri.with({ path: path.join(uri.path, 'modules', 'm00001', 'index.cnxml') }))
    assert.strictEqual(roots.length, 1)
    assert.strictEqual(roots[0].fsPath, TEST_DATA_DIR)
  })
  test('getLocalResourceRoots works when there is no folder for a resource', () => {
    function getBaseRoots(scheme: any): readonly vscode.Uri[] {
      const resource = {
        scheme: scheme,
        fsPath: '/some/path/to/file'
      } as any as vscode.Uri
      return getLocalResourceRoots([], resource)
    }
    const folder = {} as any as vscode.WorkspaceFolder // the content does not matter
    const s = sinon.stub(vscode.workspace, 'getWorkspaceFolder').returns(folder)
    sinon.stub(vscode.workspace, 'workspaceFolders').get(() => [{ uri: '/some/path/does/not/matter' }])
    assert.strictEqual(getBaseRoots('CASE-T-T-?').length, 1)
    sinon.stub(vscode.workspace, 'workspaceFolders').get(() => undefined)
    assert.strictEqual(getBaseRoots('CASE-T-F-?').length, 0)
    s.restore()
    sinon.stub(vscode.workspace, 'getWorkspaceFolder').returns(undefined)
    assert.strictEqual(getBaseRoots('CASE-F-?-F').length, 0)
    // CASE-F-?-T
    assert.strictEqual(getBaseRoots('file').length, 1)
    assert.strictEqual(getBaseRoots('').length, 1)
  })
  test('show toc editor', async () => {
    await withPanelFromCommand(OpenstaxCommand.SHOW_TOC_EDITOR, async (panel) => {
      const html = panel.webview.html
      assert.notStrictEqual(html, null)
      assert.notStrictEqual(html, undefined)
      assert.notStrictEqual(html.indexOf('html'), -1)
    })
  }).timeout(5000)
  test('toc editor handle refresh', async () => {
    const requests: any[] = []
    const mockClient = {
      sendRequest: (...args: any[]) => { requests.push(args); return [] }
    }
    await withPanelFromCommand(OpenstaxCommand.SHOW_TOC_EDITOR, async (panel) => {
      const handler = tocEditorHandleMessage(panel, mockClient as unknown as LanguageClient)
      await handler({ type: 'refresh' })
    })
    const expected = [
      [ExtensionServerRequest.BundleTrees, { workspaceUri: `file://${TEST_DATA_DIR}` }],
      [ExtensionServerRequest.BundleModules, { workspaceUri: `file://${TEST_DATA_DIR}` }],
      [ExtensionServerRequest.BundleOrphanedModules, { workspaceUri: `file://${TEST_DATA_DIR}` }]
    ]
    assert.deepStrictEqual(requests, expected)
  }).timeout(5000)
  test('toc editor handle refresh from extension base', async () => {
    const requests: any[] = []
    const mockClient = {
      sendRequest: (...args: any[]) => { requests.push(args); return [] }
    }
    await withPanelFromCommand(OpenstaxCommand.SHOW_TOC_EDITOR, async (panel) => {
      const refresher = refreshTocPanel(mockClient as unknown as LanguageClient)
      await refresher()
    })
    const expected = [
      [ExtensionServerRequest.BundleTrees, { workspaceUri: `file://${TEST_DATA_DIR}` }],
      [ExtensionServerRequest.BundleModules, { workspaceUri: `file://${TEST_DATA_DIR}` }],
      [ExtensionServerRequest.BundleOrphanedModules, { workspaceUri: `file://${TEST_DATA_DIR}` }]
    ]
    assert.deepStrictEqual(requests, expected)
  }).timeout(5000)
  test('toc editor handle refresh from extension base without existing panel', async () => {
    const requests: any[] = []
    const mockClient = {
      sendRequest: (...args: any[]) => { requests.push(args); return [] }
    }
    const refresher = refreshTocPanel(mockClient as unknown as LanguageClient)
    await refresher()
    assert.deepStrictEqual(requests, [])
  })
  test('toc editor handle data message', async () => {
    const uri = expect(getRootPathUri())
    const collectionPath = path.join(uri.fsPath, 'collections', 'test.collection.xml')
    const before = fs.readFileSync(collectionPath)
    const mockEditAddModule: TocTreeCollection = {
      type: TocTreeElementType.collection,
      title: 'test collection',
      slug: 'test',
      children: [{
        type: TocTreeElementType.subcollection,
        title: 'subcollection',
        children: [{
          type: TocTreeElementType.module,
          moduleid: 'm00001',
          title: 'Introduction'
        }]
      }, {
        type: TocTreeElementType.module,
        moduleid: 'm00002',
        title: 'Unnamed Module'
      }]
    }
    await withPanelFromCommand(OpenstaxCommand.SHOW_TOC_EDITOR, async (panel) => {
      const handler = tocEditorHandleMessage(panel, null as unknown as LanguageClient)
      await handler({ type: 'write-tree', treeData: mockEditAddModule })
    })
    const after = fs.readFileSync(collectionPath, { encoding: 'utf-8' })
    assert.strictEqual(before.indexOf('m00002'), -1)
    assert.notStrictEqual(after.indexOf('m00002'), -1)
  }).timeout(5000)
  test('toc editor handle error message', async () => {
    await withPanelFromCommand(OpenstaxCommand.SHOW_TOC_EDITOR, async (panel) => {
      const handler = tocEditorHandleMessage(panel, null as unknown as LanguageClient)
      await assert.rejects(async () => await handler({ type: 'error', message: 'test' }))
    })
  }).timeout(5000)
  test('toc editor handle unexpected message', async () => {
    await withPanelFromCommand(OpenstaxCommand.SHOW_TOC_EDITOR, async (panel) => {
      const handler = tocEditorHandleMessage(panel, null as unknown as LanguageClient)
      await assert.rejects(async () => await handler({ type: 'foo' } as unknown as TocPanelIncomingMessage))
    })
  }).timeout(5000)
  test('toc editor handle subcollection create', async () => {
    await withPanelFromCommand(OpenstaxCommand.SHOW_TOC_EDITOR, async (panel) => {
      const handler = tocEditorHandleMessage(panel, null as unknown as LanguageClient)
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
      const handler = tocEditorHandleMessage(panel, null as unknown as LanguageClient)
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
    const moduleId = select('//md:content-id', document) as Node[]
    assert.strictEqual(moduleId.length, 1)
    assert.strictEqual(moduleId[0].textContent, 'm00004')
    const moduleUUIDv4 = select('//md:uuid', document) as Node[]
    const uuidRgx = /^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/
    let uuidV4: any = null
    uuidV4 = moduleUUIDv4[0].textContent
    assert.strictEqual(moduleUUIDv4.length, 1)
    assert(uuidRgx.test(uuidV4))
  })
  test('toc editor handle module rename best case', async () => {
    await withPanelFromCommand(OpenstaxCommand.SHOW_TOC_EDITOR, async (panel) => {
      const handler = tocEditorHandleMessage(panel, null as unknown as LanguageClient)
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
      const handler = tocEditorHandleMessage(panel, null as unknown as LanguageClient)
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
  test('show image upload', async () => {
    await withPanelFromCommand(OpenstaxCommand.SHOW_IMAGE_UPLOAD, async (panel) => {
      const html = panel.webview.html
      assert.notStrictEqual(html, null)
      assert.notStrictEqual(html, undefined)
      assert.notStrictEqual(html.indexOf('html'), -1)
    })
  }).timeout(5000)
  test('image upload handle message', async () => {
    const data = fs.readFileSync(path.join(TEST_DATA_DIR, 'media/urgent.jpg'), { encoding: 'base64' })
    const handler = imageUploadHandleMessage()
    await handler({ mediaUploads: [{ mediaName: 'urgent2.jpg', data: 'data:image/jpeg;base64,' + data }] })
    const uploaded = fs.readFileSync(path.join(TEST_DATA_DIR, 'media/urgent2.jpg'), { encoding: 'base64' })
    assert.strictEqual(data, uploaded)
  })
  test('image upload handle message ignore duplicate image', async () => {
    const data = fs.readFileSync(path.join(TEST_DATA_DIR, 'media/urgent.jpg'), { encoding: 'base64' })
    const handler = imageUploadHandleMessage()
    await handler({ mediaUploads: [{ mediaName: 'urgent.jpg', data: 'data:image/jpeg;base64,0' }] })
    const newData = fs.readFileSync(path.join(TEST_DATA_DIR, 'media/urgent.jpg'), { encoding: 'base64' })
    assert.strictEqual(data, newData)
  })
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
    const before = document.getText()
    const testData = '<document>Test</document>'
    const handler = cnxmlPreviewHandleMessage(resource)
    await handler({ xml: testData })
    const modified = document.getText()
    assert.strictEqual(modified, testData)
    assert.notStrictEqual(modified, before)
  })
  test('panel disposed and refocused', async () => {
    await assert.doesNotReject(async () => {
      await withPanelFromCommand(OpenstaxCommand.SHOW_TOC_EDITOR, async (panel) => { })
      await withPanelFromCommand(OpenstaxCommand.SHOW_TOC_EDITOR, async (panel) => { })
    })
  }).timeout(5000)
  test('panel opener opens new panel if it does not exist', async () => {
    const mockPanelActivationByType = {
      [PanelType.TOC_EDITOR]: sinon.stub(),
      [PanelType.IMAGE_UPLOAD]: sinon.stub(),
      [PanelType.CNXML_PREVIEW]: sinon.stub()
    }
    const opener = createLazyPanelOpener(mockPanelActivationByType)
    const result = opener(PanelType.IMAGE_UPLOAD, false)
    result('test')
    assert(mockPanelActivationByType[PanelType.IMAGE_UPLOAD].calledOnceWith('test'))
    assert(mockPanelActivationByType[PanelType.CNXML_PREVIEW].notCalled)
    assert(mockPanelActivationByType[PanelType.TOC_EDITOR].notCalled)
  })
  test('panel opener opens new panel if it exists, but is disposed', async () => {
    await withPanelFromCommand(OpenstaxCommand.SHOW_IMAGE_UPLOAD, async (panel) => { })
    const mockPanelActivationByType = {
      [PanelType.TOC_EDITOR]: sinon.stub(),
      [PanelType.IMAGE_UPLOAD]: sinon.stub(),
      [PanelType.CNXML_PREVIEW]: sinon.stub()
    }
    const opener = createLazyPanelOpener(mockPanelActivationByType)
    const result = opener(PanelType.IMAGE_UPLOAD, false)
    result('test')
    assert(mockPanelActivationByType[PanelType.IMAGE_UPLOAD].calledOnceWith('test'))
    assert(mockPanelActivationByType[PanelType.CNXML_PREVIEW].notCalled)
    assert(mockPanelActivationByType[PanelType.TOC_EDITOR].notCalled)
  })
  test('panel opener focuses new panel on soft refocus if it exists', async () => {
    await withPanelFromCommand(OpenstaxCommand.SHOW_IMAGE_UPLOAD, async (panel) => {
      const revealStub = sinon.stub(panel, 'reveal')
      const mockPanelActivationByType = {
        [PanelType.TOC_EDITOR]: sinon.stub(),
        [PanelType.IMAGE_UPLOAD]: sinon.stub(),
        [PanelType.CNXML_PREVIEW]: sinon.stub()
      }
      const opener = createLazyPanelOpener(mockPanelActivationByType)
      const result = opener(PanelType.IMAGE_UPLOAD, false)
      result('test')
      assert(mockPanelActivationByType[PanelType.IMAGE_UPLOAD].notCalled)
      assert(mockPanelActivationByType[PanelType.CNXML_PREVIEW].notCalled)
      assert(mockPanelActivationByType[PanelType.TOC_EDITOR].notCalled)
      assert(revealStub.calledOnce)
    })
  })
  test('panel opener opens new panel on hard refocus even if it exists', async () => {
    await withPanelFromCommand(OpenstaxCommand.SHOW_IMAGE_UPLOAD, async (panel) => {
      const revealStub = sinon.stub(panel, 'reveal')
      const mockPanelActivationByType = {
        [PanelType.TOC_EDITOR]: sinon.stub(),
        [PanelType.IMAGE_UPLOAD]: sinon.stub(),
        [PanelType.CNXML_PREVIEW]: sinon.stub()
      }
      const opener = createLazyPanelOpener(mockPanelActivationByType)
      const result = opener(PanelType.IMAGE_UPLOAD, true)
      result('test')
      assert(mockPanelActivationByType[PanelType.IMAGE_UPLOAD].calledOnceWith('test'))
      assert(mockPanelActivationByType[PanelType.CNXML_PREVIEW].notCalled)
      assert(mockPanelActivationByType[PanelType.TOC_EDITOR].notCalled)
      assert(revealStub.notCalled)
    })
  })
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
    const requests: any = []
    const mockClient = {
      sendRequest: (...args: any[]) => { requests.push(args); return [] }
    }
    const forwarder = forwardOnDidChangeWorkspaceFolders(mockClient as unknown as LanguageClient)
    await forwarder('test_event' as unknown as vscode.WorkspaceFoldersChangeEvent)
    const expected = [
      ['onDidChangeWorkspaceFolders', 'test_event']
    ]
    assert.deepStrictEqual(requests, expected)
  })
  test('TocTreesProvider returns expected TocTreeItems', async () => {
    const sendRequestMock = sinon.stub()
    const mockClient: LanguageClient = {
      sendRequest: sendRequestMock
    } as any as LanguageClient
    const fakeTreeCollection: TocTreeCollection[] = []
    fakeTreeCollection.push(
      {
        type: TocTreeElementType.collection,
        title: 'Collection1',
        slug: 'collection1',
        children: [{
          type: TocTreeElementType.subcollection,
          title: 'subcollection',
          children: [{
            type: TocTreeElementType.module,
            moduleid: 'm00001',
            title: 'Module1'
          },
          {
            type: TocTreeElementType.module,
            moduleid: 'm00002',
            title: 'Module2'
          }]
        }]
      },
      {
        type: TocTreeElementType.collection,
        title: 'Collection2',
        slug: 'collection2',
        children: [{
          type: TocTreeElementType.module,
          moduleid: 'm00003',
          title: 'Module3'
        }]
      }
    )
    const fakeWorkspacePath = '/tmp/fakeworkspace'
    sinon.stub(utils, 'getRootPathUri').returns(vscode.Uri.file(fakeWorkspacePath))
    const module1Item = new TocTreeItem(
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
      'subcollection',
      vscode.TreeItemCollapsibleState.Collapsed,
      [module1Item, module2Item]
    )
    const collection1Item = new TocTreeItem(
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
      'Collection2',
      vscode.TreeItemCollapsibleState.Collapsed,
      [module3Item],
      {
        title: 'open',
        command: 'vscode.open',
        arguments: [vscode.Uri.file(`${fakeWorkspacePath}/collections/collection2.collection.xml`)]
      }
    )

    const tocTreesProvider = new TocTreesProvider(mockClient)
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

    const view: vscode.TreeView<TocTreeItem> = {
      reveal: revealStub
    } as unknown as vscode.TreeView<TocTreeItem>
    const provider: TocTreesProvider = {
      toggleFilterMode: toggleFilterStub,
      getChildren: getChildrenStub,
      refresh: refreshStub
    } as unknown as TocTreesProvider
    getChildrenStub.resolves([{ label: 'col1' }, { label: 'col2' }])

    const handler = toggleTocTreesFilteringHandler(view, provider)
    await handler()
    assert(toggleFilterStub.calledOnce)
    assert(getChildrenStub.calledOnce)
    assert(revealStub.calledTwice)
    assert(revealStub.calledWith({ label: 'col1' }, { expand: 3 }))
    assert(revealStub.calledWith({ label: 'col2' }, { expand: 3 }))
    assert(refreshStub.calledTwice)
  })
  test('TocTreesProvider fires event on refresh', async () => {
    const mockClient: LanguageClient = {} as any as LanguageClient
    const tocTreesProvider = new TocTreesProvider(mockClient)
    const eventFire = sinon.stub((tocTreesProvider as any)._onDidChangeTreeData, 'fire')
    tocTreesProvider.refresh()
    assert(eventFire.calledOnce)
  })
  test('TocTreesProvider calls refresh when toggling filter mode', async () => {
    const mockClient: LanguageClient = {} as any as LanguageClient
    const tocTreesProvider = new TocTreesProvider(mockClient)
    const refresh = sinon.stub(tocTreesProvider, 'refresh')
    tocTreesProvider.toggleFilterMode()
    assert(refresh.calledOnce)
  })
  test('invokeRefreshers calls functions', async () => {
    const func1 = sinon.stub().resolves()
    const func2 = sinon.stub().resolves()
    await invokeRefreshers([func1, func2])()
    assert(func1.calledOnce)
    assert(func2.calledOnce)
  })

  this.afterAll(async () => {
    await deactivate()
  })
})

// Push Content Tests
const ignore = async (message: string): Promise<string | undefined> => { return undefined }
const makeCaptureMessage = (messages: string[]): (message: string) => Promise<string | undefined> => {
  const captureMessage = async (message: string): Promise<string | undefined> => {
    messages.push(message)
    return undefined
  }
  return captureMessage
}
const makeMockInputMessage = (message: string): () => Promise<string | undefined> => {
  const mockMessageInput = async (): Promise<string | undefined> => { return message }
  return mockMessageInput
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
    const mockMessageInput = makeMockInputMessage('poet commit')

    const getRepo = (): Repository => {
      const stubRepo = Substitute.for<Repository>()

      stubRepo.commit('poet commit', commitOptions).resolves()
      stubRepo.pull().resolves()
      stubRepo.push().resolves()

      return stubRepo
    }

    await assert.doesNotReject(pushContent._pushContent(getRepo, mockMessageInput, captureMessage, ignore)())
    assert.strictEqual(messages.length, 1)
    assert.strictEqual(messages[0], 'Successful content push.')
  })
  test('push with merge conflict', async () => {
    const messages: string[] = []
    const captureMessage = makeCaptureMessage(messages)
    const mockMessageInput = makeMockInputMessage('poet commit')
    const error: any = { _fake: 'FakeSoStackTraceIsNotInConsole', message: '' }

    error.gitErrorCode = GitErrorCodes.Conflict

    const getRepo = (): Repository => {
      const stubRepo = Substitute.for<Repository>()

      stubRepo.commit('poet commit', commitOptions).resolves()
      stubRepo.pull().rejects(error)
      stubRepo.push().resolves()

      return stubRepo
    }

    await assert.doesNotReject(pushContent._pushContent(getRepo, mockMessageInput, ignore, captureMessage)())
    assert.strictEqual(messages.length, 1)
    assert.strictEqual(messages[0], 'Content conflict, please resolve.')
  })
  test('unknown commit error', async () => {
    const messages: string[] = []
    const captureMessage = makeCaptureMessage(messages)
    const mockMessageInput = makeMockInputMessage('poet commit')
    const error: any = { _fake: 'FakeSoStackTraceIsNotInConsole', message: '' }

    error.gitErrorCode = ''

    const getRepo = (): Repository => {
      const stubRepo = Substitute.for<Repository>()

      stubRepo.commit('poet commit', commitOptions).resolves()
      stubRepo.pull().rejects(error)
      stubRepo.push().resolves()

      return stubRepo
    }

    await assert.doesNotReject(pushContent._pushContent(getRepo, mockMessageInput, ignore, captureMessage)())
    assert.strictEqual(messages.length, 1)
    assert.strictEqual(messages[0], 'Push failed: ')
  })
  test('push with no changes', async () => {
    const messages: string[] = []
    const captureMessage = makeCaptureMessage(messages)
    const mockMessageInput = makeMockInputMessage('poet commit')
    const error: any = { _fake: 'FakeSoStackTraceIsNotInConsole', message: '' }

    error.stdout = 'nothing to commit.'

    const getRepo = (): Repository => {
      const stubRepo = Substitute.for<Repository>()

      stubRepo.commit('poet commit', commitOptions).rejects(error)
      stubRepo.pull().resolves()
      stubRepo.push().resolves()

      return stubRepo
    }

    await assert.doesNotReject(pushContent._pushContent(getRepo, mockMessageInput, ignore, captureMessage)())
    assert.strictEqual(messages.length, 1)
    assert.strictEqual(messages[0], 'No changes to push.')
  })
  test('unknown push error', async () => {
    const messages: string[] = []
    const captureMessage = makeCaptureMessage(messages)
    const mockMessageInput = makeMockInputMessage('poet commit')
    const error: any = { _fake: 'FakeSoStackTraceIsNotInConsole', message: '' }

    error.stdout = ''

    const getRepo = (): Repository => {
      const stubRepo = Substitute.for<Repository>()

      stubRepo.commit('poet commit', commitOptions).rejects(error)
      stubRepo.pull().resolves()
      stubRepo.push().resolves()

      return stubRepo
    }

    await assert.doesNotReject(pushContent._pushContent(getRepo, mockMessageInput, ignore, captureMessage)())
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
    const mockMessageInput = makeMockInputMessage('poet commit')
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
    await assert.doesNotReject(pushContent._pushContent(getRepo, mockMessageInput, captureMessage, ignore)())
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
})
