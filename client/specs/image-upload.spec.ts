import { join } from 'path'
import { expect } from '@jest/globals'
import SinonRoot from 'sinon'
import mockfs from 'mock-fs'

import vscode from 'vscode'
import * as utils from '../src/utils' // Used for dependency mocking in tests
import { type LanguageClient } from 'vscode-languageclient/node'
import { EMPTY_BOOKS_AND_ORPHANS } from '../../common/src/requests'
import { type ExtensionEvents } from '../src/panel'
import { ImageManagerPanel } from '../src/panel-image-manager'

const actualResourceRootDir = join(__dirname, '../static')
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

describe('image-upload Panel', () => {
  const fakeWorkspacePath = '/tmp/fakeworkspace'
  const resourceRootDir = 'fakeresourcerootdir'
  const sinon = SinonRoot.createSandbox()
  const createMockClient = (): LanguageClient => {
    return {
      sendRequest: sinon.stub().returns([]),
      onRequest: sinon.stub().returns({ dispose: () => { } })
    } as unknown as LanguageClient
  }

  beforeEach(() => {
    const fs: any = {}
    fs[resourceRootDir] = mockfs.load(actualResourceRootDir)
    mockfs(fs)
    sinon.stub(utils, 'getRootPathUri').returns(vscode.Uri.file(fakeWorkspacePath))
  })
  afterEach(() => {
    mockfs.restore()
    sinon.restore()
  })

  it('image upload handle message', async () => {
    // sinon.stub(vscode.workspace.fs, 'stat').throws('stubbed so that the code thinks the file does not exist')
    const stub = sinon.stub(vscode.workspace.fs, 'writeFile')

    const panel = new ImageManagerPanel({ bookTocs: EMPTY_BOOKS_AND_ORPHANS, resourceRootDir, client: createMockClient(), events: createMockEvents().events })
    await panel.handleMessage({ mediaUploads: [{ mediaName: 'urgent.jpg', data: 'data:image/jpeg;base64,0' }] })
    expect(stub.callCount).toBe(1)
    expect(stub.firstCall.args[1].toString()).toBe('') // we set it to 0-bytes file in the previous line
  })

  it('image upload handle message ignore duplicate image', async () => {
    sinon.stub(vscode.workspace.fs, 'stat').resolves(undefined) // code just cares if this method throws
    const stub = sinon.stub(vscode.workspace.fs, 'writeFile')

    const panel = new ImageManagerPanel({ bookTocs: EMPTY_BOOKS_AND_ORPHANS, resourceRootDir, client: createMockClient(), events: createMockEvents().events })
    await panel.handleMessage({ mediaUploads: [{ mediaName: 'urgent.jpg', data: 'data:image/jpeg;base64,0' }] })
    expect(stub.callCount).toBe(0)
  })
})
