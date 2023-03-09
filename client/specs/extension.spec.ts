import { join } from 'path'
import expect from 'expect'
import mockfs from 'mock-fs'

import { activate, deactivate, forwardOnDidChangeWorkspaceFolders, setLanguageServerLauncher, setResourceRootDir } from '../src/extension'
import { Extension, ExtensionContext, WebviewPanel } from 'vscode'
import * as vscode from 'vscode'
import * as utils from '../src/utils' // Used for dependency mocking in tests
import Sinon from 'sinon'
import { LanguageClient } from 'vscode-languageclient/node'
import { OpenstaxCommand } from '../src/extension-types'
import { TocEditorPanel } from '../src/panel-toc-editor'
import { BooksAndOrphans, ExtensionServerNotification } from '../../common/src/requests'
import { PanelManager } from '../src/panel'
import { CnxmlPreviewPanel } from '../src/panel-cnxml-preview'
import * as pushContent from '../src/push-content'

describe('Extension', () => {
  const sinon = Sinon.createSandbox()
  beforeEach(async () => sinon.stub(pushContent, 'setDefaultGitConfig').resolves())
  afterEach(async () => sinon.restore())
  it('forwardOnDidChangeWorkspaceFolders sends a request to the language server', async function () {
    const stub = sinon.stub()
    const client = { sendRequest: stub } as unknown as LanguageClient
    const ev = { added: [], removed: [] } // WorkspaceFoldersChangeEvent
    await forwardOnDidChangeWorkspaceFolders(client)(ev)
    expect(stub.callCount).toBe(1)
  })

  describe('with mocked languageserver client', () => {
    let onNotificationStub = sinon.stub()
    beforeEach(() => {
      const sendRequestStub = sinon.stub()
      onNotificationStub = sinon.stub()
      const mockClient = {
        stop: sinon.stub(),
        onReady: async () => {},
        onRequest: sinon.stub(),
        onNotification: onNotificationStub,
        sendRequest: sendRequestStub,
        start: sinon.stub()
      } as unknown as LanguageClient
      setLanguageServerLauncher(() => mockClient)
    })
    describe('activation/deactivation', () => {
      const extensionContext = {
        asAbsolutePath: (p: string) => join(__dirname, '..', '..', p)
      } as unknown as ExtensionContext
      afterEach(async () => await deactivate())
      it('Starts up', async function () {
        await expect(activate(extensionContext)).resolves.toBeTruthy()
      })
      it('updates the TocPanel when the language server sends a BookTocs Notification', async () => {
        setResourceRootDir(join(__dirname, '..', 'static'))

        const extensions = await activate(extensionContext)
        const pm = extensions[OpenstaxCommand.SHOW_TOC_EDITOR]
        expect(pm.panel()).toBeNull()

        expect(onNotificationStub.firstCall.args[0]).toBe(ExtensionServerNotification.BookTocs)
        const cb = onNotificationStub.firstCall.args[1]
        const params: BooksAndOrphans = { books: [], orphans: [] }
        cb(params)

        const panel = pm.newPanel() as TocEditorPanel
        const updateStub = sinon.stub(panel, 'update')
        cb(params)

        expect(updateStub.callCount).toBe(1)
      })
    })
    describe('panels', () => {
      const fakeResourceRootDir = '/fake-resource-root-dir'
      const fakeWorkspacePath = '/path/to/workspace'
      const fakeWorkspaceFile = '/path/to/workspace/onlytheextensionmatters.cnxml'
      beforeEach(async () => {
        const fs: any = {}
        fs[fakeWorkspaceFile] = '<document xmlns="http://cnx.rice.edu/cnxml"><content></content></document>'
        // fs[fakeResourceRootDir] = mockfs.load(join(__dirname, '..', 'static'))
        fs[fakeResourceRootDir] = {
          'cnxml-preview.html': '<html>skjdfhksjdhfsjkdfh</html>',
          'cnxml-to-html5.xsl': '<notreallyused/>'
        }
        mockfs(fs)
      })
      afterEach(() => mockfs.restore())

      // Copy-pasta
      const extensionContext = {
        resourceRootDir: fakeResourceRootDir,
        asAbsolutePath: (p: string) => join(__dirname, '..', '..', p)
      } as unknown as ExtensionContext
      const fakeXmlExtension: Extension<any> = {
        activate: sinon.stub().resolves({
          addXMLCatalogs: (catalogs: string[]): void => {}
        })
      } as any as Extension<any>
      // Stub the XML extension temporarily for this test helper setup so activate()
      beforeEach(() => {
        sinon.stub(vscode.extensions, 'getExtension').withArgs('redhat.vscode-xml').returns(fakeXmlExtension)
        sinon.stub(utils, 'getRootPathUri').returns(vscode.Uri.file(fakeWorkspacePath))
        setResourceRootDir(fakeResourceRootDir)
      })
      afterEach(async () => await deactivate())

      it('show cnxml preview with no file open', async () => {
        expect(vscode.window.activeTextEditor).toBeUndefined()
        const extensions = await activate(extensionContext)
        const pm = extensions[OpenstaxCommand.SHOW_CNXML_PREVIEW] as PanelManager<CnxmlPreviewPanel>
        const panel1 = pm.revealOrNew()
        const panel = (panel1 as any).panel as WebviewPanel // `.panel` is a protected field
        expect(panel.webview.html).toEqual(expect.stringContaining('No resource available to preview'))
      })

      it('show cnxml preview with a file open', async () => {
        const fakeEditor: vscode.TextEditor = {
          document: {
            lineAt: () => ({ text: 'fakedata' }),
            languageId: 'xml',
            uri: {
              fsPath: fakeWorkspaceFile
            }
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
        expect(vscode.window.activeTextEditor).not.toBeUndefined()
        const extensions = await activate(extensionContext)
        const pm = extensions[OpenstaxCommand.SHOW_CNXML_PREVIEW] as PanelManager<CnxmlPreviewPanel>
        const panel1 = pm.revealOrNew()
        const panel = (panel1 as any).panel as WebviewPanel // `.panel` is a protected field
        expect(panel.webview.html).toEqual(expect.stringContaining('<html'))
      })
    })
  })
})
