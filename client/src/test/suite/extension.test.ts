import assert from 'assert'
import fs from 'fs-extra'
import path from 'path'
import vscode from 'vscode'
import 'source-map-support/register'
import { expect, getRootPathUri, getLocalResourceRoots, fixResourceReferences, fixCspSourceReferences, addBaseHref } from './../../utils'
import { activate } from './../../extension'
import { handleMessage as tocEditorHandleMessage, TocTreeCollection } from './../../panel-toc-editor'
import { handleMessage as imageUploadHandleMessage } from './../../panel-image-upload'
import { handleMessage as cnxmlPreviewHandleMessage } from './../../panel-cnxml-preview'
import { commandToPanelType, OpenstaxCommand } from '../../extension-types'
import { Suite } from 'mocha'

// Test runs in out/test/suite, not src/test/suite
const ORIGIN_DATA_DIR = path.join(__dirname, '../../../src/test/data/test-repo')
const TEST_DATA_DIR = path.join(__dirname, '../data/test-repo')

const contextStub = {
  asAbsolutePath: (relPath: string) => path.resolve(__dirname, '../../../../', relPath)
}
const extensionExports = activate(contextStub as any)

async function sleep(ms: number): Promise<void> {
  return await new Promise(resolve => setTimeout(resolve, ms))
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
  const panel = expect(extensionExports.activePanelsByType[commandToPanelType[command]])
  await func(panel)
  panel.dispose()
}

const resetTestData = async (): Promise<void> => {
  await vscode.workspace.saveAll(true)
  fs.rmdirSync(TEST_DATA_DIR, { recursive: true })
  fs.mkdirpSync(TEST_DATA_DIR)
  fs.copySync(ORIGIN_DATA_DIR, TEST_DATA_DIR)
}

suite('Unsaved Files', function (this: Suite) {
  this.beforeEach(resetTestData)
  test('show cnxml preview with no file open', async () => {
    assert.strictEqual(vscode.window.activeTextEditor, undefined)
    await vscode.commands.executeCommand(OpenstaxCommand.SHOW_CNXML_PREVIEW)
    await sleep(1000) // Wait for panel to load
    const panel = extensionExports.activePanelsByType[commandToPanelType[OpenstaxCommand.SHOW_CNXML_PREVIEW]]
    assert.strictEqual(panel, undefined)
  })
})

suite('Extension Test Suite', function (this: Suite) {
  this.beforeEach(resetTestData)
  test('expect unwraps non-null', () => {
    const maybe: string | null = 'test'
    assert.doesNotThrow(() => { expect(maybe) })
  })
  test('expect unwraps null', async () => {
    const maybe: string | null = null
    assert.throws(() => { expect(maybe) })
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
  test('show toc editor', async () => {
    await withPanelFromCommand(OpenstaxCommand.SHOW_TOC_EDITOR, async (panel) => {
      const html = panel.webview.html
      assert.notStrictEqual(html, null)
      assert.notStrictEqual(html, undefined)
      assert.notStrictEqual(html.indexOf('html'), -1)
    })
  }).timeout(5000)
  test('toc editor handle data message', async () => {
    const uri = expect(getRootPathUri())
    const collectionUri = uri.with({ path: path.join(uri.path, 'collections', 'test.collection.xml') })
    const document = await vscode.workspace.openTextDocument(collectionUri)
    const before = document.getText()
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
      const handler = tocEditorHandleMessage(panel)
      await handler({ type: 'write-tree', treeData: mockEditAddModule })
      const after = document.getText()
      assert.strictEqual(before.indexOf('m00002'), -1)
      assert.notStrictEqual(after.indexOf('m00002'), -1)
    })
  }).timeout(5000)
  test('toc editor handle signal message', async () => {
    await withPanelFromCommand(OpenstaxCommand.SHOW_TOC_EDITOR, async (panel) => {
      const handler = tocEditorHandleMessage(panel)
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      assert.rejects(handler({ type: 'error', message: 'test' }))
    })
  }).timeout(5000)
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
      await withPanelFromCommand(OpenstaxCommand.SHOW_TOC_EDITOR, async (panel) => {})
      await withPanelFromCommand(OpenstaxCommand.SHOW_TOC_EDITOR, async (panel) => {})
    })
  }).timeout(5000)
})
