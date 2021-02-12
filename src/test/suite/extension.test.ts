import assert from 'assert'
import fs from 'fs'
import path from 'path'
import vscode from 'vscode'
import { expect, getRootPathUri, getLocalResourceRoots, fixResourceReferences, fixCspSourceReferences, addBaseHref } from './../../utils'
import { activate } from './../../extension'
import { handleMessage as tocEditorHandleMessage, TocTreeCollection } from './../../panel-toc-editor'
import { handleMessage as imageUploadHandleMessage } from './../../panel-image-upload'
import { handleMessage as cnxmlPreviewHandleMessage } from './../../panel-cnxml-preview'

const TEST_DATA_DIR = path.join(__dirname, '../data/test-repo') // Running in out/test/suite, not src/test/suite
const extensionExports = activate(undefined as any)

async function sleep(ms: number): Promise<void> {
  return await new Promise(resolve => setTimeout(resolve, ms))
}

const withTestPanel = (html: string, func: (arg0: vscode.WebviewPanel) => void) => {
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

suite('Extension Test Suite', () => {
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
    await vscode.commands.executeCommand('openstax.showTocEditor')
    await sleep(1000)
    const html = expect(extensionExports.activePanelsByType['openstax.tocEditor']).webview.html
    assert.notStrictEqual(html, null)
    assert.notStrictEqual(html, undefined)
    assert.notStrictEqual(html.indexOf('html'), -1)
  }).timeout(5000)
  test('toc editor handle data message', async () => {
    const uri = expect(getRootPathUri())
    const collectionUri = uri.with({ path: path.join(uri.path, 'collections', 'test.collection.xml') })
    const document = await vscode.workspace.openTextDocument(collectionUri)
    const before = document.getText()
    await vscode.commands.executeCommand('openstax.showTocEditor')
    await sleep(1000)
    const panel = expect(extensionExports.activePanelsByType['openstax.tocEditor'])
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
    await tocEditorHandleMessage(panel, { editable: [], uneditable: [] })({ treeData: mockEditAddModule })
    const after = document.getText()
    assert.strictEqual(before.indexOf('m00002'), -1)
    assert.notStrictEqual(after.indexOf('m00002'), -1)

    // Clean up
    const fullRange = new vscode.Range(
      document.positionAt(0),
      document.positionAt(document.getText().length)
    )
    const edit = new vscode.WorkspaceEdit()
    edit.replace(collectionUri, fullRange, before)
    await vscode.workspace.applyEdit(edit)
    await document.save()
    assert.strictEqual(before, document.getText())
  }).timeout(5000)
  test('toc editor handle signal message', async () => {
    await vscode.commands.executeCommand('openstax.showTocEditor')
    await sleep(1000)
    const panel = expect(extensionExports.activePanelsByType['openstax.tocEditor'])
    assert.rejects(tocEditorHandleMessage(panel, { editable: [], uneditable: [] })({ signal: { type: 'error', message: 'test' } }))
  }).timeout(5000)
  test('show image upload', async () => {
    await vscode.commands.executeCommand('openstax.showImageUpload')
    await sleep(1000)
    const html = expect(extensionExports.activePanelsByType['openstax.imageUpload']).webview.html
    assert.notStrictEqual(html, null)
    assert.notStrictEqual(html, undefined)
    assert.notStrictEqual(html.indexOf('html'), -1)
  }).timeout(5000)
  test('image upload handle message', async () => {
    const data = fs.readFileSync(path.join(TEST_DATA_DIR, 'media/urgent.jpg'), { encoding: 'base64' })
    await imageUploadHandleMessage()({mediaUploads: [{mediaName: 'urgent2.jpg', data: 'data:image/jpeg;base64,' + data}]})
    const uploaded = fs.readFileSync(path.join(TEST_DATA_DIR, 'media/urgent2.jpg'), { encoding: 'base64' })
    assert.strictEqual(data, uploaded)

    // Cleanup
    fs.unlinkSync(path.join(TEST_DATA_DIR, 'media/urgent2.jpg'))
  })
  test('image upload handle message ignore duplicate image', async () => {
    const data = fs.readFileSync(path.join(TEST_DATA_DIR, 'media/urgent.jpg'), { encoding: 'base64' })
    await imageUploadHandleMessage()({mediaUploads: [{mediaName: 'urgent.jpg', data: 'data:image/jpeg;base64,0'}]})
    const newData = fs.readFileSync(path.join(TEST_DATA_DIR, 'media/urgent.jpg'), { encoding: 'base64' })
    assert.strictEqual(data, newData)
  })
  test('show cnxml preview', async () => {
    const uri = expect(getRootPathUri())
    const resource = uri.with({ path: path.join(uri.path, 'modules', 'm00001', 'index.cnxml') })
    const document = await vscode.workspace.openTextDocument(resource)
    await vscode.window.showTextDocument(document)
    await vscode.commands.executeCommand('openstax.showPreviewToSide')
    await sleep(1000)
    const html = expect(extensionExports.activePanelsByType['openstax.cnxmlPreview']).webview.html
    assert.notStrictEqual(html, null)
    assert.notStrictEqual(html, undefined)
    assert.notStrictEqual(html.indexOf('html'), -1)
  }).timeout(5000)
  test('cnxml preview handle message', async () => {
    const uri = expect(getRootPathUri())
    const resource = uri.with({ path: path.join(uri.path, 'modules', 'm00001', 'index.cnxml') })
    const document = await vscode.workspace.openTextDocument(resource)
    const before = document.getText()
    const testData = '<document>Test</document>'
    await cnxmlPreviewHandleMessage(resource)({xml: testData})
    const modified = document.getText()
    assert.strictEqual(modified, testData)
    assert.notStrictEqual(modified, before)
    
    // Clean up
    const fullRange = new vscode.Range(
      document.positionAt(0),
      document.positionAt(document.getText().length)
    )
    const edit = new vscode.WorkspaceEdit()
    edit.replace(resource, fullRange, before)
    await vscode.workspace.applyEdit(edit)
    await document.save()
    assert.strictEqual(before, document.getText())
  })
  test('cnxml preview with edits', async () => {
    const uri = expect(getRootPathUri())
    const resource = uri.with({ path: path.join(uri.path, 'modules', 'm00001', 'index.cnxml') })
    const document = await vscode.workspace.openTextDocument(resource)
    await vscode.window.showTextDocument(document)
    await vscode.commands.executeCommand('openstax.showPreviewToSide')
    await sleep(1000)
    const documentBefore = document.getText()
    const htmlBefore = expect(extensionExports.activePanelsByType['openstax.cnxmlPreview']).webview.html

    const insertIndex = documentBefore.indexOf('</content>')

    assert.strictEqual(htmlBefore.indexOf('__INSERTED__'), -1)
    assert.notStrictEqual(htmlAfter.indexOf('__INSERTED__'), -1)

    // Clean up
    const fullRange = new vscode.Range(
      document.positionAt(0),
      document.positionAt(document.getText().length)
    )
    const edit = new vscode.WorkspaceEdit()
    edit.replace(resource, fullRange, documentBefore)
    await vscode.workspace.applyEdit(edit)
    await document.save()
    assert.strictEqual(documentBefore, document.getText())
  })
  test('panel disposed and refocused', async () => {
    await assert.doesNotReject(async () => {
      await vscode.commands.executeCommand('openstax.showTocEditor')
      await sleep(1000)
      const panel = expect(extensionExports.activePanelsByType['openstax.tocEditor'])
      panel.dispose()
      await vscode.commands.executeCommand('openstax.showTocEditor')
      await sleep(1000)
    })    
  }).timeout(5000)
})
