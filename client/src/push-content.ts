import vscode from 'vscode'
import { expect, getErrorDiagnosticsBySource, getRootPathUri } from './utils'
import { GitExtension, GitErrorCodes, CommitOptions, Repository, RefType, Ref } from './git-api/git'
import { ExtensionHostContext } from './panel'
import { DiagnosticSource, requestEnsureIds } from '../../common/src/requests'

export const PushValidationModal = {
  cnxmlErrorMsg: 'There are outstanding validation errors that must be resolved before pushing is allowed.',
  xmlErrorMsg: 'There are outstanding schema errors that must be resolved before pushing is allowed.'
}

export const canPush = async (errorsBySource: Map<string, Array<[vscode.Uri, vscode.Diagnostic]>>): Promise<boolean> => {
  if (errorsBySource.has(DiagnosticSource.cnxml)) {
    void vscode.window.showErrorMessage(PushValidationModal.cnxmlErrorMsg, { modal: true })
    return false
  }
  if (errorsBySource.has(DiagnosticSource.xml)) {
    await vscode.window.showErrorMessage(PushValidationModal.xmlErrorMsg, { modal: true })
    return false
  }
  return true
}

export const getRepo = (): Repository => {
  const gitExtension = expect(vscode.extensions.getExtension<GitExtension>('vscode.git'), 'Expected vscode.git extension to be installed').exports
  const api = gitExtension.getAPI(1)
  const result: Repository = api.repositories[0]
  return result
}

export const getNewTag = (repo: Repository, head: Ref): string => {
  const shortSha = head.commit?.slice(0, 7)
  if (shortSha === undefined) {
    throw new Error('Could not get commit at head.')
  }
  const repeatCount = repo.state.refs.filter((ref, _) => {
    return (ref.type === RefType.Tag && ref.commit === head.commit)
  }).length
  if (repeatCount > 0) {
    throw new Error('A build already exists for this content version.')
  }
  return shortSha
}

export const validateMessage = (message: string): string | null => {
  return message.length > 2 ? null : 'Too short!'
}

export const getMessage = async (): Promise<string | undefined> => {
  const message = await vscode.window.showInputBox({
    prompt: 'Push Message: ',
    placeHolder: '...',
    validateInput: validateMessage
  })
  return message
}

export const pushContent = (hostContext: ExtensionHostContext) => async () => {
  if (await canPush(getErrorDiagnosticsBySource())) {
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'Push Content',
      cancellable: true
    }, async (progress, token) => {
      token.onCancellationRequested(() => {
        /* istanbul ignore next */
        console.log('User canceled the push operation')
      })
      // indeterminate progress https://github.com/Microsoft/vscode/issues/47387#issuecomment-379537556
      progress.report({ message: 'Creating Auto Element IDs, please wait...' })
      // const serverErrorMessage = 'Server cannot properly find workspace'
      const uri = expect(getRootPathUri(), 'No root path in which to generate a module')
      // fix ids
      // TODO: better ui in future. Add `increment` value in `progress.report` and use a callback to update real progress
      await requestEnsureIds(hostContext.client, { workspaceUri: uri.toString() })
      // push content
      progress.report({ message: 'Pushing...' })
      await _pushContent(getRepo, getMessage, vscode.window.showInformationMessage, vscode.window.showErrorMessage)()
    })
  }
}

interface GitError extends Error {
  stdout: string | null
  gitErrorCode?: string
}

export const _pushContent = (
  _getRepo: () => Repository,
  _getMessage: () => Thenable<string | undefined>,
  infoReporter: (msg: string) => Thenable<string | undefined>,
  errorReporter: (msg: string) => Thenable<string | undefined>
) => async () => {
  const repo = _getRepo()
  const commitOptions: CommitOptions = { all: true }

  let commitSucceeded = false

  const commitMessage = await _getMessage()
  /* istanbul ignore if */
  if (commitMessage == null) { return }
  try {
    await repo.commit(commitMessage, commitOptions)
    commitSucceeded = true
  } catch (err) {
    const e = err as GitError
    /* istanbul ignore if */
    if (e.stdout == null) { throw e }
    if (e.stdout.includes('nothing to commit')) {
      void errorReporter('No changes to push.')
    } else {
      const message: string = e.gitErrorCode === undefined ? e.message : /* istanbul ignore next */ e.gitErrorCode
      void errorReporter(`Push failed: ${message}`)
    }
  }

  if (commitSucceeded) {
    const head = expect(repo.state.HEAD, 'This does not appear to be a git repository. Create one first')
    const branchName = expect(head.name, 'You do not appear to have a branch checked out. Maybe you checked out a commit or are in the middle of rebasing?')
    try {
      if (head.upstream != null) {
        await repo.pull()
        await repo.push()
      } else {
        await repo.push('origin', branchName, true)
      }
      void infoReporter('Successful content push.')
    } catch (err) {
      const e = err as GitError
      /* istanbul ignore if */
      if (e.gitErrorCode == null) { throw e }
      if (e.gitErrorCode === GitErrorCodes.Conflict) {
        void errorReporter('Content conflict, please resolve.')
      } else {
        void errorReporter(`Push failed: ${e.message}`)
      }
    }
  }
}

export const tagContent = async (): Promise<void> => {
  const repo = getRepo()
  const head = expect(repo.state.HEAD, 'This does not appear to be a git repository. Create one first')
  let tag: string
  expect(head.name, 'You do not appear to have a branch checked out. Maybe you checked out a commit or are in the middle of rebasing?')
  await repo.fetch()

  if ((await repo.diffWithHEAD()).length > 0) {
    void vscode.window.showErrorMessage('Can\'t tag. Local unpushed changes exist', { modal: false })
    return
  }

  try {
    tag = getNewTag(repo, head)
    await (repo as any)._repository.tag(tag) // when VSCode API is updated -> await repo.tag(tag)
  } catch (err) {
    const e = err as GitError
    const message: string = e.gitErrorCode === undefined ? e.message : /* istanbul ignore next */ e.gitErrorCode
    void vscode.window.showErrorMessage(`Tagging failed: ${message}`, { modal: false }) // ${String(e.stderr)}
    return
  }

  // push
  try {
    await repo.push('origin', tag)
    void vscode.window.showInformationMessage('Successfully queued CORGI job.', { modal: false })
  } catch (err) {
    const e = err as GitError
    const message: string = e.gitErrorCode === undefined ? e.message : /* istanbul ignore next */ e.gitErrorCode
    void vscode.window.showErrorMessage(`Failed to queue CORGI job: ${message}`, { modal: false })
  }
}
