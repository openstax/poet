import vscode from 'vscode'
import { expect } from './utils'
import { GitExtension, GitErrorCodes, CommitOptions, Repository } from './git'

export const getRepo = (): Repository => {
  const gitExtension = expect(vscode.extensions.getExtension<GitExtension>('vscode.git')).exports
  const api = gitExtension.getAPI(1)
  const result: Repository = api.repositories[0]
  return result
}

export const pushContent = () => async () => {
  const repo = getRepo()
  const commitOptions: CommitOptions = { all: true }

  let commitSucceeded = false

  try {
    await repo.commit('poet commit', commitOptions)
    commitSucceeded = true
  } catch (e) {
    if (e.stdout == null) { throw e }
    if ((e.stdout as string).includes('nothing to commit')) {
      void vscode.window.showErrorMessage('No changes to push.')
    } else {
      const message: string = e.gitErrorCode === undefined ? e.message : e.gitErrorCode
      void vscode.window.showErrorMessage(`Push failed: ${message}`)
    }
  }

  if (commitSucceeded) {
    try {
      await repo.pull()
      await repo.push()
      void vscode.window.showInformationMessage('Successful content push.')
    } catch (e) {
      if (e.gitErrorCode == null) { throw e }
      if (e.gitErrorCode === GitErrorCodes.Conflict) {
        void vscode.window.showErrorMessage('Content conflict, please resolve.')
      } else {
        void vscode.window.showErrorMessage(`Push failed: ${e.message as string}`)
      }
    }
  }
}
