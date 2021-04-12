import vscode from 'vscode'
import path from 'path'
import { LanguageClient } from 'vscode-languageclient/node'
import { TocEditorPanel } from './panel-toc-editor'
import { CnxmlPreviewPanel } from './panel-cnxml-preview'
import { pushContent } from './push-content'
import { expect, ensureCatch, launchLanguageServer, populateXsdSchemaFiles } from './utils'
import { OpenstaxCommand } from './extension-types'
import { Panel, PanelManager } from './panel'
import { ImageManagerPanel } from './panel-image-manager'

const resourceRootDir = path.join(__dirname) // extension is running in dist/
let client: LanguageClient

export const forwardOnDidChangeWorkspaceFolders = (clientInner: LanguageClient) => async (event: vscode.WorkspaceFoldersChangeEvent) => {
  await clientInner.sendRequest('onDidChangeWorkspaceFolders', event)
}

type ExtensionExports = {[key in OpenstaxCommand]: PanelManager<Panel<unknown, unknown>>}
export async function activate(context: vscode.ExtensionContext): Promise<ExtensionExports> {
  // detect Theia. Alert the user if they are running Theia
  expect(process.env.GITPOD_HOST != null && process.env.EDITOR?.includes('code') === false ? undefined : true, 'You seem to be running the Theia editor. Change your Settings in your profile')

  client = launchLanguageServer(context)
  populateXsdSchemaFiles(resourceRootDir)
  await client.onReady()

  const hostContext = {
    resourceRootDir,
    client
  }
  const tocPanelManager = new PanelManager(hostContext, TocEditorPanel)
  const cnxmlPreviewPanelManager = new PanelManager(hostContext, CnxmlPreviewPanel)
  const imageManagerPanelManager = new PanelManager(hostContext, ImageManagerPanel)

  vscode.workspace.onDidChangeWorkspaceFolders(ensureCatch(forwardOnDidChangeWorkspaceFolders(client)))
  vscode.commands.registerCommand(OpenstaxCommand.SHOW_TOC_EDITOR, tocPanelManager.revealOrNew.bind(tocPanelManager))
  vscode.commands.registerCommand(OpenstaxCommand.SHOW_IMAGE_MANAGER, imageManagerPanelManager.revealOrNew.bind(imageManagerPanelManager))
  vscode.commands.registerCommand(OpenstaxCommand.SHOW_CNXML_PREVIEW, cnxmlPreviewPanelManager.revealOrNew.bind(cnxmlPreviewPanelManager))
  vscode.commands.registerCommand('openstax.pushContent', ensureCatch(pushContent()))

  const extExports: ExtensionExports = {
    [OpenstaxCommand.SHOW_TOC_EDITOR]: tocPanelManager,
    [OpenstaxCommand.SHOW_CNXML_PREVIEW]: cnxmlPreviewPanelManager,
    [OpenstaxCommand.SHOW_IMAGE_MANAGER]: imageManagerPanelManager
  }
  return extExports
}

export async function deactivate(): Promise<void> {
  await expect(client, 'Expected client to have been activated').stop()
}
