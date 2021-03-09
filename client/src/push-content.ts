import vscode from 'vscode'
import { expect } from './utils'
import { GitExtension, GitErrorCodes, CommitOptions } from './git'

export const pushContent = (resourceRootDir: string) => async () => {
  const gitExtension = expect(vscode.extensions.getExtension<GitExtension>('vscode.git')).exports
  const api = gitExtension.getAPI(1)
  const repo = api.repositories[0]

  const commitOptions: CommitOptions = {
    all: true
  }

  try {
    await repo.commit('poet commit', commitOptions)
    try {
      await repo.pull()
      await repo.push()
      await vscode.window.showInformationMessage('Successful content push.')
    } catch (e) {
      if (!(e as any).gitErrorCode) { throw e }
      if (e.gitErrorCode === GitErrorCodes.Conflict) {
        await vscode.window.showErrorMessage('Content conflict, please resolve.')
      } else {
        await vscode.window.showErrorMessage(`Push failed: ${e.gitErrorCode}`)
      }
    }
  } catch (e) {
    try {

      await vscode.window.showErrorMessage(e.gitErrorCode)
    } catch (e) {
      await vscode.window.showErrorMessage("¯\_(ツ)_/¯")
    }

    if (!(e as any).gitErrorCode) { await vscode.window.showErrorMessage(e) }
    // if (e.gitErrorCode === GitErrorCodes.NoLocalChanges) {
    // Not working yet (commit doesn't use GitErrorCodes ¯\_(ツ)_/¯)
    if ((e as any).stdout.includes('nothing to commit')) {
      await vscode.window.showErrorMessage('No changes to push.')
    } else {
      await vscode.window.showErrorMessage(`Push failed: ${e}`)
    }
  }
}
