import vscode from 'vscode'
import { requestGenerateReadme } from '../../common/src/requests'
import { type ExtensionHostContext } from './panel'
import { expect, getRootPathUri } from './utils'
import { getRemotes } from './push-content'

export function readmeGenerator(hostContext: ExtensionHostContext) {
  const remotes = getRemotes()
  const { owner, repoName } = expect(
    remotes.find((r) => r !== undefined && r.name === 'origin'),
    'BUG: no origin found'
  )
  return async () => {
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
