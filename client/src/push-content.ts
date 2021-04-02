import vscode from 'vscode'
import { expect } from './utils'
import { GitExtension, GitErrorCodes, CommitOptions, Repository } from './git-api/git'

export const getRepo = (): Repository => {
  const gitExtension = expect(vscode.extensions.getExtension<GitExtension>('vscode.git'), 'Expected vscode.git extension to be installed').exports
  const api = gitExtension.getAPI(1)
  const result: Repository = api.repositories[0]
  return result
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

export const pushContent = () => async () => {
  await _pushContent(getRepo, getMessage, vscode.window.showInformationMessage, vscode.window.showErrorMessage)()
}

export const _pushContent = (_getRepo: () => Repository, _getMessage: () => Thenable<string | undefined>, infoReporter: (msg: string) => Thenable<string | undefined>, errorReporter: (msg: string) => Thenable<string | undefined>) => async () => {
  const repo = _getRepo()
  const commitOptions: CommitOptions = { all: true }

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

  if (!commitSucceeded) { return }
  try {
    await repo.pull()
    await repo.push()
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
