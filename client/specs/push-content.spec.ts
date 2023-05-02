import Sinon from 'sinon'
import * as pushContent from '../src/push-content'
import * as utils from '../src/utils'
import { Repository, Change, Status, CommitOptions, GitExtension, GitErrorCodes, Branch, RepositoryState, RefType } from '../src/git-api/git.d'
import vscode from 'vscode'
import expect from 'expect'
import { Substitute } from '@fluffy-spoon/substitute'
import { ExtensionHostContext } from '../src/panel'
import { DiagnosticSource, ExtensionServerRequest } from '../../common/src/requests'

const makeCaptureMessage = (messages: string[]): (message: string) => Promise<string | undefined> => {
  return async (message: string): Promise<string | undefined> => {
    messages.push(message)
    return undefined
  }
}

const makeMockDialog = (message: string): () => Promise<string | undefined> => {
  return async (): Promise<string | undefined> => { return message }
}

const ignore = async (message: string): Promise<string | undefined> => { return undefined }

describe('Push Button Test Suite', () => {
  const sinon = Sinon.createSandbox()
  beforeEach(() => {
    // openAndValidate is tested fully later in this file
    sinon.stub(pushContent, 'openAndValidate')
      .resolves(new Map<string, Array<[vscode.Uri, vscode.Diagnostic]>>())
  })
  afterEach(() => sinon.restore())
  const commitOptions: CommitOptions = { all: true }
  const sendRequestMock = sinon.stub()
  const mockHostContext: ExtensionHostContext = {
    client: {
      sendRequest: sendRequestMock
    }
  } as any as ExtensionHostContext
  const withProgressNoCancel = (
    options: vscode.ProgressOptions,
    task: (
      progress: vscode.Progress<{ message?: string, increment?: number }>,
      token: vscode.CancellationToken
    ) => Thenable<unknown>
  ): Thenable<unknown> => {
    return new Promise((resolve, reject) => {
      try {
        resolve(
          task(
            { report: (_: { message?: string, increment?: number }) => {} },
            { isCancellationRequested: false, onCancellationRequested: sinon.stub() }
          )
        )
      } catch (e) {
        reject(e)
      }
    })
  }
  // This was once an integration test, now it is kind of pointless.
  test('getRepo returns a repository', async () => {
    const getExtensionStub = Substitute.for<vscode.Extension<GitExtension>>()
    sinon.stub(vscode.extensions, 'getExtension').returns(getExtensionStub)
    const repo = pushContent.getRepo()
    expect(repo.rootUri).toBeDefined()
  })
  test('pushContent pushes with no conflict', async () => {
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

    await pushContent._pushContent(
      getRepo,
      mockMessageInput,
      captureMessage,
      ignore
    )()

    expect(messages.length).toBe(1)
    expect(messages[0]).toBe('Successful content push.')
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

    await pushContent._pushContent(
      getRepo,
      mockMessageInput,
      ignore,
      captureMessage
    )()

    expect(messages.length).toBe(1)
    expect(messages[0]).toBe('Content conflict, please resolve.')
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

    await pushContent._pushContent(
      getRepo,
      mockMessageInput,
      ignore,
      captureMessage
    )()

    expect(messages.length).toBe(1)
    expect(messages[0]).toBe('Push failed: ')
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

    await pushContent._pushContent(
      getRepo,
      mockMessageInput,
      ignore,
      captureMessage
    )()

    expect(messages.length).toBe(1)
    expect(messages[0]).toBe('No changes to push.')
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

    await pushContent._pushContent(
      getRepo,
      mockMessageInput,
      ignore,
      captureMessage
    )()

    expect(messages.length).toBe(1)
    expect(messages[0]).toBe('Push failed: ')
  })
  test('does not invoke _pushContent when canPush is false', async () => {
    const file1Diag1 = { severity: vscode.DiagnosticSeverity.Error, source: 'source1' } as any as vscode.Diagnostic
    sinon.stub(vscode.languages, 'getDiagnostics').returns([
      [vscode.Uri.file('fsdjf'), [file1Diag1]]
    ])
    sinon.stub(pushContent, 'canPush').returns(false)
    const stubPushContentHelperInner = sinon.stub()
    sinon.stub(pushContent, '_pushContent').returns(stubPushContentHelperInner)
    await pushContent.pushContent(mockHostContext)()
    expect(stubPushContentHelperInner.notCalled).toBe(true)
    expect(sendRequestMock.notCalled).toBe(true)
  })
  test('pushContent invokes _pushContent when canPush is true', async () => {
    sinon.stub(utils, 'getErrorDiagnosticsBySource').resolves(new Map<string, Array<[vscode.Uri, vscode.Diagnostic]>>())
    sinon.stub(pushContent, 'getMessage').resolves('poet commit')
    sinon.stub(pushContent, 'canPush').returns(true)
    sinon.stub(utils, 'getRootPathUri').returns(vscode.Uri.file('fjsdlf'))
    sinon.stub(vscode.window, 'withProgress').callsFake(withProgressNoCancel)
    const stubPushContentHelperInner = sinon.stub()
    sinon.stub(pushContent, '_pushContent').returns(stubPushContentHelperInner)
    await pushContent.pushContent(mockHostContext)()
    expect(stubPushContentHelperInner.calledOnce).toBe(true)
    expect(sendRequestMock.calledOnceWith(
      ExtensionServerRequest.BundleEnsureIds
    )).toBe(true)
  })
  test('pushes to new branch', async () => {
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
    await pushContent._pushContent(
      getRepo,
      mockMessageInput,
      captureMessage,
      ignore
    )()

    expect(messages.length).toBe(1)
    expect(messages[0]).toBe('Successful content push.')
    expect(pushStub.calledOnceWith('origin', newBranchName, true)).toBe(true)
  })
  test('get message returns showInputBox input', async () => {
    sinon.stub(vscode.window, 'showInputBox').resolves('test')
    expect(await pushContent.getMessage()).toBe('test')
  })
  test('validateMessage returns "Too short!" for message that is not long enough', async () => {
    expect(pushContent.validateMessage('a')).toBe('Too short!')
  })
  test('validateMessage returns null for message that is long enough', async () => {
    expect(pushContent.validateMessage('abc')).toBe(null)
  })
  test('taggingDialog', async () => {
    const mockDialog = sinon.stub(vscode.window, 'showInformationMessage')
    mockDialog.resolves(undefined)
    expect(await pushContent.taggingDialog()).toBe(undefined)
    mockDialog.resolves(pushContent.Tag.release as any as vscode.MessageItem)
    expect(await pushContent.taggingDialog()).toBe(pushContent.Tag.release)
    mockDialog.resolves(pushContent.Tag.candidate as any as vscode.MessageItem)
    expect(await pushContent.taggingDialog()).toBe(pushContent.Tag.candidate)
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

    expect(await pushContent.getNewTag(mockRepo, pushContent.Tag.candidate, mockHead)).toBe('1rc')
    mockRepo.state.refs.push({
      name: '1rc',
      type: RefType.Tag,
      commit: 'b'
    })

    expect(await pushContent.getNewTag(mockRepo, pushContent.Tag.candidate, mockHead)).toBe('2rc')
    mockRepo.state.refs.push({
      name: '2rc',
      type: RefType.Tag,
      commit: 'a'
    })
    expect(await pushContent.getNewTag(mockRepo, pushContent.Tag.candidate, mockHead)).toBe(undefined)
    expect(showErrorMsgStub.calledOnceWith('Tag of this type already exists for this content version.', { modal: false })).toBe(true)
    showErrorMsgStub.reset()

    mockRepo.state.refs.length = 0
    mockRepo.state.refs.push({
      name: 'main',
      type: RefType.Head,
      commit: 'a'
    })

    expect(await pushContent.getNewTag(mockRepo, pushContent.Tag.release, mockHead)).toBe('1')
    mockRepo.state.refs.push({
      name: '1',
      type: RefType.Tag,
      commit: 'b'
    })

    expect(await pushContent.getNewTag(mockRepo, pushContent.Tag.release, mockHead)).toBe('2')
    mockRepo.state.refs.push({
      name: '2',
      type: RefType.Tag,
      commit: 'a'
    })
    expect(await pushContent.getNewTag(mockRepo, pushContent.Tag.release, mockHead)).toBe(undefined)
    expect(showErrorMsgStub.calledOnceWith('Tag of this type already exists for this content version.', { modal: false })).toBe(true)
  })
  test('canPush returns correct values', async () => {
    const fileUri = { path: '/test.cnxml', scheme: 'file' } as any as vscode.Uri
    const poetError = {
      severity: vscode.DiagnosticSeverity.Error,
      source: DiagnosticSource.poet
    } as any as vscode.Diagnostic
    const xmlError = {
      severity: vscode.DiagnosticSeverity.Error,
      source: DiagnosticSource.xml
    } as any as vscode.Diagnostic
    const errorsBySource = new Map<string, Array<[vscode.Uri, vscode.Diagnostic]>>()
    const showErrorMsgStub = sinon.stub(vscode.window, 'showErrorMessage')

    // No errors
    expect(pushContent.canPush(errorsBySource)).toBe(true)

    // CNXML errors
    errorsBySource.set(DiagnosticSource.poet, [[fileUri, poetError]])
    expect(!pushContent.canPush(errorsBySource)).toBe(true)
    expect(showErrorMsgStub.calledOnceWith(pushContent.PushValidationModal.poetErrorMsg, { modal: true })).toBe(true)

    // Both Poet and XML errors
    errorsBySource.clear()
    showErrorMsgStub.reset()
    errorsBySource.set(DiagnosticSource.poet, [[fileUri, poetError]])
    errorsBySource.set(DiagnosticSource.xml, [[fileUri, xmlError]])
    expect(!pushContent.canPush(errorsBySource)).toBe(true)
    expect(showErrorMsgStub.calledOnceWith(pushContent.PushValidationModal.poetErrorMsg, { modal: true })).toBe(true)

    // XML errors, user cancels
    errorsBySource.clear()
    showErrorMsgStub.reset()
    showErrorMsgStub.returns(Promise.resolve(undefined))
    errorsBySource.set(DiagnosticSource.xml, [[fileUri, xmlError]])
    expect(!pushContent.canPush(errorsBySource)).toBe(true)
    expect(showErrorMsgStub.calledOnceWith(pushContent.PushValidationModal.xmlErrorMsg, { modal: true })).toBe(true)
  })
})

describe('tests with sinon', () => {
  const sinon = Sinon.createSandbox()
  afterEach(async () => sinon.restore())
  describe('validateContent', () => {
    it('only runs when it should', async () => {
      const showInformationMessageStub = sinon.stub(vscode.window, 'showInformationMessage')
      const openAndValidateStub = sinon.stub(pushContent, 'openAndValidate')

      showInformationMessageStub.resolves(undefined)
      await pushContent.validateContent()
      expect(openAndValidateStub.notCalled).toBe(true)
      openAndValidateStub.reset()

      // 'as any' is required here because of showQuickPick overloading
      showInformationMessageStub.resolves(pushContent.DocumentsToOpen.all as any)
      await pushContent.validateContent()
      expect(openAndValidateStub.calledWith(pushContent.DocumentsToOpen.all)).toBe(true)
    })
  })
  describe('getDocumentsToOpen', () => {
    it('returns all files', async () => {
      const findFilesStub = sinon.stub(vscode.workspace, 'findFiles')
      const filesToReturn = [vscode.Uri.file('/a'), vscode.Uri.file('/b'), vscode.Uri.file('/c')]
      findFilesStub.resolves(filesToReturn)
      let toOpen = await pushContent.getDocumentsToOpen(pushContent.DocumentsToOpen.all)
      expect(findFilesStub.calledOnce).toBe(true)
      filesToReturn.forEach(uri => {
        expect(toOpen.has(uri.toString())).toBe(true)
      })

      // We do not need to open documents that are already open
      toOpen = await pushContent.getDocumentsToOpen(
        pushContent.DocumentsToOpen.all
      )
      expect(toOpen.size === filesToReturn.length)
    })
    it('returns changed files', async () => {
      const changesToReturn: Change[] = [
        vscode.Uri.file('/a.xml'),
        vscode.Uri.file('/b.cnxml'),
        vscode.Uri.file('/c.xhtml')
      ].map((uri, i) => ({
        originalUri: uri,
        uri: uri,
        renameUri: undefined,
        status: i === 0 ? Status.DELETED : Status.MODIFIED
      }))
      const stubRepo = {
        state: {
          workingTreeChanges: changesToReturn
        }
      } as any as Repository
      sinon.stub(pushContent, 'getRepo').returns(stubRepo)

      const toOpen = await pushContent.getDocumentsToOpen(pushContent.DocumentsToOpen.modified)
      changesToReturn
        .filter(c => c.status !== Status.DELETED)
        .forEach(c => expect(toOpen.has(c.uri.toString())).toBe(true))
      changesToReturn
        .filter(c => c.status === Status.DELETED)
        .forEach(c => expect(toOpen.has(c.uri.toString())).toBe(false))
      expect(toOpen.size === 2)
    })
  })
  describe('Cancellation', () => {
    it('Cancels openAndValidate', async () => {
      const activeTextEditorStub = sinon.stub(vscode.window, 'activeTextEditor')
      const executeCommandStub = sinon.stub(vscode.commands, 'executeCommand')
      const withProgressStub = sinon.stub(vscode.window, 'withProgress')
      let error: Error | undefined
      activeTextEditorStub.get(() => ({ document: { uri: vscode.Uri.file('/a') } }))
      // I could stub vscode.CancellationSource, but this seems less error prone
      withProgressStub.callsFake((
        options: vscode.ProgressOptions,
        task: (
          progress: vscode.Progress<{ message?: string, increment?: number }>,
          token: vscode.CancellationToken
        ) => Thenable<unknown>
      ): Thenable<unknown> => {
        return new Promise((resolve, reject) => {
          try {
            resolve(task(
              { report: (_: { message?: string, increment?: number }) => {} },
              { isCancellationRequested: true, onCancellationRequested: sinon.stub() }
            ))
          } catch (e) {
            reject(e)
          }
        })
      })

      const getDocumentsToOpenStub = sinon.stub(pushContent, 'getDocumentsToOpen')
      getDocumentsToOpenStub.resolves(new Set(['not', 'used', 'here']))
      try {
        await pushContent.openAndValidate(pushContent.DocumentsToOpen.modified)
      } catch (e) {
        error = e as Error
      }
      expect(withProgressStub.calledOnce).toBe(true)
      expect(executeCommandStub.notCalled).toBe(true)
      expect(error).not.toBe(undefined)
      expect(error?.message).toBe('Canceled')
    })
  })
  describe('openAndValidate', () => {
    it('integrates', async () => {
      const dateNowStub = sinon.stub(Date, 'now')
      const withProgressStub = sinon.stub(vscode.window, 'withProgress')
      const getDocumentsToOpenStub = sinon.stub(pushContent, 'getDocumentsToOpen')
      const showTextDocumentStub = sinon.stub(vscode.window, 'showTextDocument')
        .callsFake((uri: vscode.Uri, options?: vscode.TextDocumentShowOptions): Thenable<vscode.TextEditor> => {
          return new Promise((resolve, reject) => resolve(
            { document: { uri: uri } as any as vscode.TextDocument } as any as vscode.TextEditor
          ))
        })
      const executeCommandStub = sinon.stub(vscode.commands, 'executeCommand').resolves()
      const getDiagnosticsStub = sinon.stub(vscode.languages, 'getDiagnostics')
      const filesToReturn = [vscode.Uri.file('/a'), vscode.Uri.file('/b'), vscode.Uri.file('/c')]
      let dateNowCallCount = 0
      let progressReportCount = 0
      sinon.stub(pushContent, 'sleep').resolves()
      // Cover situations that take more than 10 seconds
      dateNowStub.callsFake(() => dateNowCallCount++ * 10000)
      getDocumentsToOpenStub.resolves(new Set(filesToReturn.map(uri => uri.toString())))
      withProgressStub.callsFake((
        options: vscode.ProgressOptions,
        task: (
          progress: vscode.Progress<{ message?: string, increment?: number }>,
          token: vscode.CancellationToken
        ) => Thenable<unknown>
      ): Thenable<unknown> => {
        return new Promise((resolve, reject) => {
          try {
            resolve(task(
              {
                report: (value: { message?: string, increment?: number }) => {
                  progressReportCount++
                  expect(
                    value.message !== undefined &&
                    value.message.length > 0 && (
                      // make sure the time estimate is only added after the first progress report
                      progressReportCount > 1
                        ? value.message.includes('remaining')
                        : !value.message.includes('remaining')
                    )
                  ).toBe(true)
                }
              },
              { isCancellationRequested: false, onCancellationRequested: sinon.stub() }
            ))
          } catch (e) {
            reject(e)
          }
        })
      })

      getDiagnosticsStub.returns([])
      let errors = await pushContent.openAndValidate(pushContent.DocumentsToOpen.all)
      expect([...errors.values()].flat().length).toBe(0)
      filesToReturn.forEach(uri => {
        expect(showTextDocumentStub.calledWith(uri)).toBe(true)
      })
      expect(executeCommandStub.calledWith('workbench.action.closeActiveEditor')).toBe(true)
      expect(executeCommandStub.callCount).toBe(3) // Close three documents with no errors
      expect(dateNowStub.callCount).toBe(11)
      expect(withProgressStub.callCount).toBe(1)
      expect(progressReportCount).toBe(4) // 1 extra call to get the progress bar spinning
      executeCommandStub.resetHistory()
      withProgressStub.resetHistory()
      showTextDocumentStub.resetHistory()
      progressReportCount = 0
      dateNowStub.reset()
      getDiagnosticsStub.reset()

      // Test for cases where errors appear (when documents should not be closed)
      const file1Diag1 = { severity: vscode.DiagnosticSeverity.Error, source: 'source1' } as any as vscode.Diagnostic
      const testDiagnostics: Array<[vscode.Uri, vscode.Diagnostic[]]> = [
        [filesToReturn[0], [file1Diag1]]
      ]
      // Cover situations that take a very small amount of time
      dateNowStub.callThrough()
      getDiagnosticsStub.returns(testDiagnostics)
      errors = await pushContent.openAndValidate(pushContent.DocumentsToOpen.all)
      expect([...errors.values()].flat().length).toBe(1)
      filesToReturn.forEach(uri => {
        expect(showTextDocumentStub.calledWith(uri)).toBe(true)
      })
      expect(executeCommandStub.calledWith('workbench.action.closeActiveEditor')).toBe(true)
      expect(executeCommandStub.callCount).toBe(2) // Close two documents with no errors
      expect(dateNowStub.callCount).toBe(5)
      expect(withProgressStub.callCount).toBe(1)
      expect(progressReportCount).toBe(1) // Just the 1 to get the progress bar spinning
    })
  })
  describe('setDefaultGitConfig', () => {
    ['pull.rebase', 'pull.ff'].forEach(key => {
      it(`is not called when ${key} is set`, async () => {
        const setConfigStub = sinon.stub().resolves()
        const stubRepo = {
          setConfig: setConfigStub,
          getConfigs: sinon.stub().resolves([{ key, value: 'true' }])
        } as any as Repository
        const stubGetRepo = sinon.stub(pushContent, 'getRepo').returns(stubRepo)
        await pushContent.setDefaultGitConfig()
        expect(stubGetRepo.callCount).toBe(1)
        expect(setConfigStub.callCount).toBe(0)
        expect(setConfigStub.calledWith('pull.ff', 'true')).toBe(false)
      })
    })
    it('is called when pull.ff and pull.rebase are unset', async () => {
      const setConfigStub = sinon.stub().resolves()
      const stubRepo = {
        setConfig: setConfigStub,
        getConfigs: sinon.stub().resolves([])
      } as any as Repository
      const stubGetRepo = sinon.stub(pushContent, 'getRepo').returns(stubRepo)
      await pushContent.setDefaultGitConfig()
      expect(stubGetRepo.callCount).toBe(1)
      expect(setConfigStub.callCount).toBe(1)
      expect(setConfigStub.calledWith('pull.ff', 'true')).toBe(true)
    })
  })
})
