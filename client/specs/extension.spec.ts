import { join } from 'path'
import expect from 'expect'

import { activate, deactivate, forwardOnDidChangeWorkspaceFolders, setLanguageServerLauncher, setResourceRootDir } from '../src/extension'
import { ExtensionContext } from 'vscode'
import Sinon from 'sinon'
import { LanguageClient } from 'vscode-languageclient/node'
import { OpenstaxCommand } from '../src/extension-types'
import { TocEditorPanel } from '../src/panel-toc-editor'
import { BookTocsArgs, ExtensionServerNotification } from '../../common/src/requests'

describe('Extension', () => {
  const sinon = Sinon.createSandbox()
  afterEach(async () => sinon.restore())
  it('forwardOnDidChangeWorkspaceFolders sends a request to the language server', async function () {
    const stub = sinon.stub()
    const client = { sendRequest: stub } as unknown as LanguageClient
    const ev = { added: [], removed: [] } // WorkspaceFoldersChangeEvent
    await forwardOnDidChangeWorkspaceFolders(client)(ev)
    expect(stub.callCount).toBe(1)
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
      const onNotificationStub = sinon.stub()
      const sendRequestStub = sinon.stub()
      const mockClient = {
        stop: sinon.stub(),
        onReady: sinon.stub(),
        onRequest: sinon.stub(),
        onNotification: onNotificationStub,
        sendRequest: sendRequestStub
      } as unknown as LanguageClient
      setLanguageServerLauncher(() => mockClient)
      setResourceRootDir(join(__dirname, '..', 'static'))

      const extensions = await activate(extensionContext)
      const pm = extensions[OpenstaxCommand.SHOW_TOC_EDITOR]
      expect(pm.panel()).toBeNull()

      expect(onNotificationStub.firstCall.args[0]).toBe(ExtensionServerNotification.BookTocs)
      const cb = onNotificationStub.firstCall.args[1]
      const params: BookTocsArgs = { version: -1, books: [], orphans: [] }
      cb(params)

      const panel = pm.newPanel() as TocEditorPanel
      const updateStub = sinon.stub(panel, 'update')
      cb(params)

      expect(updateStub.callCount).toBe(1)
    })
  })
})
