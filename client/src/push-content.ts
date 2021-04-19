import vscode from 'vscode'
import { expect, getErrorDiagnosticsBySource } from './utils'
import { GitExtension, GitErrorCodes, CommitOptions, Repository, RefType } from './git-api/git'
import { integer } from 'vscode-languageserver-types'

export enum DiagnosticSource {
  xml = 'xml',
  cnxml = 'cnxml'
}

export const PushValidationModal = {
  cnxmlErrorMsg: 'There are outstanding validation errors that must be resolved before pushing is allowed.',
  xmlErrorMsg: 'There are outstanding schema errors. Are you sure you want to push these changes?',
  xmlErrorIgnoreItem: 'Yes, I know more than you'
}

export const canPush = async (errorsBySource: Map<string, Array<[vscode.Uri, vscode.Diagnostic]>>): Promise<boolean> => {
  if (errorsBySource.has(DiagnosticSource.cnxml)) {
    void vscode.window.showErrorMessage(PushValidationModal.cnxmlErrorMsg, { modal: true })
    return false
  }
  if (errorsBySource.has(DiagnosticSource.xml)) {
    const selectedItem = await vscode.window.showErrorMessage(PushValidationModal.xmlErrorMsg, { modal: true }, PushValidationModal.xmlErrorIgnoreItem)
    return selectedItem === PushValidationModal.xmlErrorIgnoreItem
  }
  return true
}

export const getRepo = (): Repository => {
  const gitExtension = expect(vscode.extensions.getExtension<GitExtension>('vscode.git'), 'Expected vscode.git extension to be installed').exports
  const api = gitExtension.getAPI(1)
  const result: Repository = api.repositories[0]
  return result
}

export const taggingDialog = async (): Promise<string | undefined> => {
  /* instanbul ignore next */
  return await vscode.window.showInformationMessage(
    'Are you tagging for release?',
    // { modal: true },
    ...['No Tag', 'Release Candidate', 'Release']
  )
}

export const getNewTag = (repo: Repository, release: boolean): string | undefined => {
  /* instanbul ignore next */
  const tags: integer[] = []

  // could probaly use a filter-reduce here
  repo.state.refs.forEach(ref => {
    if (ref.type !== RefType.Tag) { return }
    if (release === ref.name?.includes('rc')) { return }

    const versionNumberString = expect(ref.name, '').replace('rc', '')
    tags.push(Number(versionNumberString))
  })

  const previousVersion = tags.length > 0 ? tags[tags.length - 1] : 0
  return `${previousVersion + 1}${release ? '' : 'rc'}`
}

export const validateMessage = (message: string): string | null => {
  /* istanbul ignore next */
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

export const pushContent = () => async () => {
  if (await canPush(getErrorDiagnosticsBySource())) {
    await _pushContent(getRepo, taggingDialog, getNewTag, getMessage, vscode.window.showInformationMessage, vscode.window.showErrorMessage)()
  }
}

export const _pushContent = (
  _getRepo: () => Repository,
  _taggingDialog: () => Thenable<string | undefined>,
  _getTag: (repo: Repository, release: boolean) => string | undefined,
  _getMessage: () => Thenable<string | undefined>,
  infoReporter: (msg: string) => Thenable<string | undefined>,
  errorReporter: (msg: string) => Thenable<string | undefined>
) => async () => {
  const repo = _getRepo()
  const commitOptions: CommitOptions = { all: true }

  const tagging = await _taggingDialog()
  let tag: string | undefined
  if (tagging !== 'No Tag') {
    /* instanbul ignore next */
    const tagMode = tagging === 'Release'
    tag = _getTag(repo, tagMode)
  }

  if (tag !== undefined) {
    /* instanbul ignore next */
    try {
      await (repo as any)._repository.tag(tag) // when VSCode API is updated -> await repo.tag(tag)
    } catch (e) {
      const message: string = e.gitErrorCode === undefined ? e.message : e.gitErrorCode
      void errorReporter(`Tagging failed: ${message} ${String(e.stderr)}`)
    }
    return
  }

  let commitSucceeded = false

  const commitMessage = await _getMessage()
  if (commitMessage == null) { return }
  try {
    await repo.commit(commitMessage, commitOptions)
    commitSucceeded = true
  } catch (e) {
    console.log(e)
    if (e.stdout == null) { throw e }
    if ((e.stdout as string).includes('nothing to commit')) {
      void errorReporter('No changes to push.')
    } else {
      const message: string = e.gitErrorCode === undefined ? e.message : e.gitErrorCode
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
    } catch (e) {
      console.log(e)
      if (e.gitErrorCode == null) { throw e }
      if (e.gitErrorCode === GitErrorCodes.Conflict) {
        void errorReporter('Content conflict, please resolve.')
      } else {
        void errorReporter(`Push failed: ${e.message as string}`)
      }
    }
  }
}
