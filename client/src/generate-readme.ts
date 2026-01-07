import vscode from 'vscode'
import { requestGenerateReadme } from '../../common/src/requests'
import { type ExtensionHostContext } from './panel'
import { expect, getRootPathUri } from './utils'
import { getRemotes } from './push-content'

export function readmeGenerator(hostContext: ExtensionHostContext) {
  return async () => {
    const remotes = getRemotes()
    const origin = remotes.find((r) => r !== undefined && r.name === 'origin')
    const { owner, repoName } = expect(origin, 'BUG: no origin found')
    await requestGenerateReadme(
      hostContext.client, {
        workspaceUri: expect(getRootPathUri(), 'Could not get root workspace uri').toString(),
        repo: {
          owner,
          name: repoName
        }
      }
    )
    void vscode.window.showInformationMessage('Generate README: Done!')
  }
}
