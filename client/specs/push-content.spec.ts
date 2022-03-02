import Sinon from 'sinon'
import * as pushContent from '../src/push-content'
import { Repository } from '../src/git-api/git.d'
import vscode from 'vscode'
import expect from 'expect'

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
      const openDocuments = [vscode.Uri.file('/b').toString()]
      findFilesStub.resolves(filesToReturn)
      let toOpen = await pushContent.getDocumentsToOpen(pushContent.DocumentsToOpen.all, new Set())
      expect(findFilesStub.calledOnce).toBe(true)
      filesToReturn.forEach(uri => {
        expect(toOpen.has(uri.toString())).toBe(true)
      })

      // We do not need to open documents that are already open
      toOpen = await pushContent.getDocumentsToOpen(
        pushContent.DocumentsToOpen.all,
        new Set(openDocuments)
      )
      expect(!toOpen.has(openDocuments[0])).toBe(true)
    })
    it('returns changed files', async () => {
      const filesToReturn = [
        { uri: vscode.Uri.file('/a') },
        { uri: vscode.Uri.file('/b') },
        { uri: vscode.Uri.file('/c') }
      ]
      const openDocuments = [vscode.Uri.file('/b').toString()]
      const diffWithHEADStub = sinon.stub()
      const stubRepo = {
        diffWithHEAD: diffWithHEADStub
      } as any as Repository
      sinon.stub(pushContent, 'getRepo').returns(stubRepo)

      diffWithHEADStub.resolves(filesToReturn)
      let toOpen = await pushContent.getDocumentsToOpen(pushContent.DocumentsToOpen.modified, new Set())
      expect(diffWithHEADStub.calledOnce).toBe(true)
      filesToReturn.forEach(o => {
        expect(toOpen.has(o.uri.toString())).toBe(true)
      })

      // We do not need to open documents that are already open
      toOpen = await pushContent.getDocumentsToOpen(
        pushContent.DocumentsToOpen.modified,
        new Set(openDocuments)
      )
      expect(!toOpen.has(openDocuments[0])).toBe(true)
    })
  })
  describe('Cancellation', () => {
    it('Cancels getOpenDocuments or openAndValidate', async () => {
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
      try {
        await pushContent.getOpenDocuments()
      } catch (e) {
        error = e as Error
      }
      expect(error).not.toBe(undefined)
      expect(error?.message).toBe('Canceled')
      expect(withProgressStub.calledOnce).toBe(true)
      expect(executeCommandStub.notCalled).toBe(true)
      withProgressStub.resetHistory()
      executeCommandStub.reset()
      error = undefined

      const getOpenDocumentsStub = sinon.stub(pushContent, 'getOpenDocuments')
      const getDocumentsToOpenStub = sinon.stub(pushContent, 'getDocumentsToOpen')
      getOpenDocumentsStub.resolves(new Set())
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
  describe('getOpenDocuments', () => {
    it('returns expected values', async () => {
      const activeTextEditorStub = sinon.stub(vscode.window, 'activeTextEditor')
      const executeCommandStub = sinon.stub(vscode.commands, 'executeCommand')
      const withProgressStub = sinon.stub(vscode.window, 'withProgress')

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
              { isCancellationRequested: false, onCancellationRequested: sinon.stub() }
            ))
          } catch (e) {
            reject(e)
          }
        })
      })

      activeTextEditorStub.get(() => undefined)
      let openDocuments = await pushContent.getOpenDocuments()
      expect(executeCommandStub.notCalled).toBe(true)
      expect(openDocuments.size).toBe(0)
      executeCommandStub.reset()
      activeTextEditorStub.reset()

      // The expected behavior is for workbench.action.nextEditor to loop around to the first editor.
      // After it loops around, the document that getOpenDocuments started on will be added to the
      // set and the function will return.
      activeTextEditorStub.get(() => {
        // NOTE: executeCommandStub could be called with something other than nextEditor
        // Could this cause unexpected behavior? Stay tuned to find out!
        switch (executeCommandStub.callCount) {
          case 0:
          case 3:
            return { document: { uri: vscode.Uri.file('/a') } }
          case 1:
            return { document: { uri: vscode.Uri.file('/b') } }
          case 2:
            return { document: { uri: vscode.Uri.file('/c') } }
          default:
            throw new Error('Something went wrong when looking for documents')
        }
      })
      executeCommandStub.resolves()
      openDocuments = await pushContent.getOpenDocuments()
      expect(openDocuments.size).toBe(3)
      expect(executeCommandStub.callCount).toBe(3)
    })
  })
  describe('openAndValidate', () => {
    it('integrates', async () => {
      const dateNowStub = sinon.stub(Date, 'now')
      const withProgressStub = sinon.stub(vscode.window, 'withProgress')
      const getOpenDocumentsStub = sinon.stub(pushContent, 'getOpenDocuments')
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
      getOpenDocumentsStub.resolves(new Set())
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
      expect(getOpenDocumentsStub.called).toBe(true)
      expect(executeCommandStub.calledWith('workbench.action.closeActiveEditor')).toBe(true)
      expect(executeCommandStub.callCount).toBe(3) // Close three documents with no errors
      expect(dateNowStub.callCount).toBe(11)
      expect(withProgressStub.callCount).toBe(1)
      expect(progressReportCount).toBe(4) // 1 extra call to get the progress bar spinning
      getOpenDocumentsStub.resetHistory()
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
      expect(getOpenDocumentsStub.called).toBe(true)
      expect(executeCommandStub.calledWith('workbench.action.closeActiveEditor')).toBe(true)
      expect(executeCommandStub.callCount).toBe(2) // Close two documents with no errors
      expect(dateNowStub.callCount).toBe(5)
      expect(withProgressStub.callCount).toBe(1)
      expect(progressReportCount).toBe(1) // Just the 1 to get the progress bar spinning
    })
  })
})
