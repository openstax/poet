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
        await repo.commit("poet commit", commitOptions)
        try {
            await repo.pull()
            await repo.push()
            vscode.window.showInformationMessage("Successful content push.")
        } catch (e) {
            if (e.gitErrorCode === GitErrorCodes.Conflict) {
                await vscode.window.showErrorMessage("Content conflict, please resolve.");
            } else {
                await vscode.window.showErrorMessage(`Push failed: ${e}`);
            }
        }
    } catch (e) {
        // if (e === GitErrorCodes.NoLocalChanges) {
        // Not working yet (commit doesn't use GitErrorCodes ¯\_(ツ)_/¯)
        if (e.stdout.includes("nothing to commit")) {
            vscode.window.showErrorMessage("No changes to push.")
        } else {
            vscode.window.showErrorMessage(`Push failed: ${e}`)
        }
    }
}