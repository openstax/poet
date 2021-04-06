import assert from 'assert'
import fs from 'fs-extra'
import path from 'path'
import vscode from 'vscode'
import SinonRoot from 'sinon'
import { GitErrorCodes, Repository, CommitOptions } from '../../git-api/git.d'
import 'source-map-support/register'
import { expect as expectOrig, ensureCatch, getRootPathUri, getLocalResourceRoots, fixResourceReferences, fixCspSourceReferences, addBaseHref, populateXsdSchemaFiles } from './../../utils'
import { activate, deactivate, refreshTocPanel } from './../../extension'
import { handleMessageFromWebviewPanel as tocEditorHandleMessage, NS_CNXML, NS_COLLECTION, NS_METADATA, PanelIncomingMessage as TocPanelIncomingMessage } from './../../panel-toc-editor'
import { handleMessage as imageUploadHandleMessage } from './../../panel-image-upload'
import { handleMessage as cnxmlPreviewHandleMessage } from './../../panel-cnxml-preview'
import { TocTreeCollection } from '../../../../common/src/toc-tree'
import { commandToPanelType, OpenstaxCommand } from '../../extension-types'
import * as pushContent from '../../push-content'
import { Suite } from 'mocha'
import { DOMParser } from 'xmldom'
import * as xpath from 'xpath-ts'
import { Substitute } from '@fluffy-spoon/substitute'
import { LanguageClient } from 'vscode-languageclient/node'
import { ExtensionServerRequest } from '../../../../common/src/requests'

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
      await refreshTocPanel(mockClient as unknown as LanguageClient)
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
    const panel = expect((await extensionExports).activePanelsByType[commandToPanelType[OpenstaxCommand.SHOW_TOC_EDITOR]])
    console.error(panel)
    await refreshTocPanel(mockClient as unknown as LanguageClient)
    assert.deepStrictEqual(requests, [])
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

  this.afterAll(async () => {
    await deactivate()
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
})
