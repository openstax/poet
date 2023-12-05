import { expect } from '@jest/globals'
import Sinon from 'sinon'
import * as vscode from 'vscode'
import { LanguageClient } from 'vscode-languageclient/node'
import { ExtensionServerRequest } from '../../common/src/requests'
import { setLanguageServerLauncher } from '../src/extension'
import { readmeGenerator } from '../src/generate-readme'
import * as utils from '../src/utils'

describe('Request readme generated', () => {
  const sinon = Sinon.createSandbox()

  afterEach(() => sinon.restore())

  it('uses correct request type and uri', async () => {
    const fakeWorkspacePath = vscode.Uri.file('/a/b/c/d')
    const getRootPathUriStub = sinon
      .stub(utils, 'getRootPathUri')
      .returns(fakeWorkspacePath)
    const sendRequestStub = sinon.stub()
    const mockClient = {
      stop: sinon.stub(),
      onReady: async () => {},
      onRequest: sinon.stub(),
      onNotification: sinon.stub(),
      sendRequest: sendRequestStub,
      start: sinon.stub()
    } as unknown as LanguageClient
    setLanguageServerLauncher(() => mockClient)
    await readmeGenerator({
      client: mockClient
    } as any)()
    expect(getRootPathUriStub.callCount).toBe(1)
    expect(sendRequestStub.callCount).toBe(1)
    expect(sendRequestStub.args[0]).toStrictEqual([
      ExtensionServerRequest.GenerateReadme,
      { workspaceUri: fakeWorkspacePath.toString() }
    ])
  })
})
