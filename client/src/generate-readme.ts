import vscode from 'vscode'
import { requestGenerateReadme } from '../../common/src/requests'
import { ExtensionHostContext } from './panel'
import { expect, getRootPathUri } from './utils'

export function readmeGenerator(hostContext: ExtensionHostContext) {
  return async () => {
    await requestGenerateReadme(
      hostContext.client, {
        workspaceUri: expect(getRootPathUri(), 'Could not get root workspace uri').toString()
      }
    )
    void vscode.window.showInformationMessage('Done!', { title: 'Generate README' })
  }
}
