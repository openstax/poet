import vscode from 'vscode'
import fs, { promises as fsPromises } from 'fs'
import path from 'path'

import xmlFormat from 'xml-formatter'
import { DOMParser, XMLSerializer } from 'xmldom'
import { fixResourceReferences, fixCspSourceReferences, getRootPathUri, expect } from './utils'
import { TocTreeCollection } from '../../common/src/toc-tree'
import { PanelType } from './extension-types'
import { LanguageClient } from 'vscode-languageclient/node'
import { BundleModulesArgs, BundleModulesResponse, BundleOrphanedModulesArgs, BundleOrphanedModulesResponse, BundleTreesArgs, BundleTreesResponse, ExtensionServerRequest } from '../../common/src/requests'
import { ExtensionHostContext, Panel } from './panel'

export const NS_COLLECTION = 'http://cnx.rice.edu/collxml'
export const NS_CNXML = 'http://cnx.rice.edu/cnxml'
export const NS_METADATA = 'http://cnx.rice.edu/mdml'

export interface DebugSignal {
  type: 'debug'
  item: any
}
export interface RefreshSignal {
  type: 'refresh'
}
export interface ErrorSignal {
  type: 'error'
  message: string
}
export interface WriteTreeSignal {
  type: 'write-tree'
  treeData: TocTreeCollection
}
export interface SubcollectionCreateSignal {
  type: 'subcollection-create'
  slug: string
}
export interface ModuleCreateSignal {
  type: 'module-create'
}
export interface ModuleRenameSignal {
  type: 'module-rename'
  moduleid: string
  newName: string
}
export type PanelIncomingMessage =
  (DebugSignal
  | RefreshSignal
  | ErrorSignal
  | WriteTreeSignal
  | SubcollectionCreateSignal
  | ModuleCreateSignal
  | ModuleRenameSignal
  )

export interface PanelOutgoingMessage {
  uneditable: TocTreeCollection[]
  editable: TocTreeCollection[]
}

const requestBundleTrees = async (client: LanguageClient, args: BundleTreesArgs): Promise<BundleTreesResponse> => {
  return await client.sendRequest(ExtensionServerRequest.BundleTrees, args)
}
const requestBundleOrphanedModules = async (client: LanguageClient, args: BundleOrphanedModulesArgs): Promise<BundleOrphanedModulesResponse> => {
  return await client.sendRequest(ExtensionServerRequest.BundleOrphanedModules, args)
}
const requestBundleModules = async (client: LanguageClient, args: BundleModulesArgs): Promise<BundleModulesResponse> => {
  return await client.sendRequest(ExtensionServerRequest.BundleModules, args)
}

async function createBlankModule(): Promise<string> {
  const template = `
<document xmlns="http://cnx.rice.edu/cnxml">
  <metadata xmlns:md="http://cnx.rice.edu/mdml">
    <md:title>New Module</md:title>
  </metadata>
  <content>
  </content>
</document>`.trim()
  const uri = expect(getRootPathUri(), 'No root path in which to generate a module')
  let moduleNumber = 0
  const moduleDirs = new Set(await fsPromises.readdir(path.join(uri.fsPath, 'modules')))
  while (true) {
    moduleNumber += 1
    const newModuleId = `m${moduleNumber.toString().padStart(5, '0')}`
    if (moduleDirs.has(newModuleId)) {
      // File exists already, try again
      continue
    }
    const newModuleUri = uri.with({ path: path.join(uri.path, 'modules', newModuleId, 'index.cnxml') })
    await vscode.workspace.fs.writeFile(newModuleUri, Buffer.from(template))
    return newModuleId
  }
}

async function createSubcollection(slug: string): Promise<void> {
  const uri = expect(getRootPathUri(), 'no root path found in which to write tree')
  const replacingUri = uri.with({ path: path.join(uri.fsPath, 'collections', `${slug}.collection.xml`) })
  const collectionData = fs.readFileSync(replacingUri.fsPath, { encoding: 'utf-8' })
  const document = new DOMParser().parseFromString(collectionData)
  const contentRoot = document.getElementsByTagNameNS(NS_COLLECTION, 'content')[0]
  // make a fake tree data collection to populate the new subcollection to the content root
  populateTreeDataToXML(document, contentRoot, {
    type: 'collection',
    title: 'fake',
    children: [{
      type: 'subcollection',
      title: 'New Subcollection',
      children: []
    }]
  })
  const serailizedXml = xmlFormat(new XMLSerializer().serializeToString(document), {
    indentation: '  ',
    collapseContent: true,
    lineSeparator: '\n'
  })
  await vscode.workspace.fs.writeFile(replacingUri, Buffer.from(serailizedXml))
}

async function renameModule(id: string, newName: string): Promise<void> {
  const uri = expect(getRootPathUri(), 'No root path in which to find renamed module')
  const moduleUri = uri.with({ path: path.join(uri.path, 'modules', id, 'index.cnxml') })
  const xml = Buffer.from(await vscode.workspace.fs.readFile(moduleUri)).toString('utf-8')
  const document = new DOMParser().parseFromString(xml)
  let metadata = document.getElementsByTagNameNS(NS_CNXML, 'metadata')[0]
  if (metadata == null) {
    const root = document.getElementsByTagNameNS(NS_CNXML, 'document')[0]
    metadata = document.createElementNS(NS_CNXML, 'metadata')
    root.appendChild(metadata)
  }
  let titleElement = metadata.getElementsByTagNameNS(NS_METADATA, 'title')[0]
  if (titleElement == null) {
    titleElement = document.createElementNS(NS_METADATA, 'md:title')
    metadata.appendChild(titleElement)
  }
  titleElement.textContent = newName
  const newData = new XMLSerializer().serializeToString(document)
  await vscode.workspace.fs.writeFile(moduleUri, Buffer.from(newData))
}

export const refreshPanel = async (panel: vscode.WebviewPanel, client: LanguageClient): Promise<void> => {
  try {
    // This attempted access will throw if the panel is disposed
    /* eslint-disable-next-line @typescript-eslint/no-unused-expressions */
    panel.webview.html
  } catch {
    // Do no work if the panel is disposed
    return
  }

  const uri = expect(getRootPathUri(), 'no workspace root from which to generate trees')
  const trees = await requestBundleTrees(client, { workspaceUri: uri.toString() })
  const allModules = await requestBundleModules(client, { workspaceUri: uri.toString() })
  const orphanModules = await requestBundleOrphanedModules(client, { workspaceUri: uri.toString() })
  if (trees == null || allModules == null || orphanModules == null) {
    /* istanbul ignore next */
    throw new Error('Server cannot properly find workspace')
  }
  const allModulesSorted = allModules.sort((m, n) => m.moduleid.localeCompare(n.moduleid))
  const orphanModulesSorted = orphanModules.sort((m, n) => m.moduleid.localeCompare(n.moduleid))
  const collectionAllModules: TocTreeCollection = {
    type: 'collection',
    title: 'All Modules',
    slug: 'mock-slug__source-only',
    children: allModulesSorted
  }
  const collectionOrphanModules: TocTreeCollection = {
    type: 'collection',
    title: 'Orphan Modules',
    slug: 'mock-slug__source-only',
    children: orphanModulesSorted
  }
  const out = {
    uneditable: [collectionAllModules, collectionOrphanModules],
    editable: trees
  }
  await panel.webview.postMessage(out)
}

export const handleMessageFromWebviewPanel = (panel: vscode.WebviewPanel, client: LanguageClient) => async (message: PanelIncomingMessage): Promise<void> => {
  if (message.type === 'refresh') {
    await refreshPanel(panel, client)
  } else if (message.type === 'error') {
    throw new Error(message.message)
  } else if (message.type === 'debug') {
    // For debugging purposes only
    /* istanbul ignore next */
    console.debug(message.item)
  } else if (message.type === 'module-create') {
    await createBlankModule()
  } else if (message.type === 'subcollection-create') {
    await createSubcollection(message.slug)
  } else if (message.type === 'module-rename') {
    const { moduleid, newName } = message
    await renameModule(moduleid, newName)
  } else if (message.type === 'write-tree') {
    await writeTree(message.treeData)
  } else {
    throw new Error(`Unexpected signal: ${JSON.stringify(message)}`)
  }
}

async function writeTree(treeData: TocTreeCollection): Promise<void> {
  const uri = expect(getRootPathUri(), 'no root path found in which to write tree')
  const slug = expect(treeData.slug, 'attempted to write tree with no slug')
  const replacingUri = uri.with({ path: path.join(uri.fsPath, 'collections', `${slug}.collection.xml`) })
  const collectionData = fs.readFileSync(replacingUri.fsPath, { encoding: 'utf-8' })
  const document = new DOMParser().parseFromString(collectionData)
  replaceCollectionContent(document, treeData)
  const serailizedXml = xmlFormat(new XMLSerializer().serializeToString(document), {
    indentation: '  ',
    collapseContent: true,
    lineSeparator: '\n'
  })
  await vscode.workspace.fs.writeFile(replacingUri, Buffer.from(serailizedXml))
}

function populateTreeDataToXML(document: XMLDocument, root: any, treeData: TocTreeCollection): void {
  for (const child of treeData.children) {
    const element = document.createElementNS(NS_COLLECTION, child.type)
    // md prefix is technically a guess. If incorrect, document may have a lot of xmlns:md attributes
    const title = document.createElementNS(NS_METADATA, 'md:title')
    const titleContent = document.createTextNode(child.title)
    title.appendChild(titleContent)
    element.appendChild(title)
    root.appendChild(element)
    if (child.type === 'subcollection') {
      const contentWrapper = document.createElementNS(NS_COLLECTION, 'content')
      element.appendChild(contentWrapper)
      populateTreeDataToXML(document, contentWrapper, child)
    } else if (child.type === 'module') {
      element.setAttribute('document', child.moduleid)
    }
  }
}

function replaceCollectionContent(document: XMLDocument, treeData: TocTreeCollection): void {
  const content = document.getElementsByTagNameNS(NS_COLLECTION, 'content')[0]

  const newContent = document.createElementNS(NS_COLLECTION, 'content')
  expect(content.parentNode, 'expected a parent element').replaceChild(newContent, content)
  populateTreeDataToXML(document, newContent, treeData)
}

const initPanel = (context: ExtensionHostContext) => () => {
  const localResourceRoots = [vscode.Uri.file(context.resourceRootDir)]
  const workspaceRoot = getRootPathUri()
  if (workspaceRoot != null) {
    localResourceRoots.push(workspaceRoot)
  }
  const panel = vscode.window.createWebviewPanel(
    PanelType.TOC_EDITOR,
    'Table of Contents Editor',
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      localResourceRoots
    }
  )

  let html = fs.readFileSync(path.join(context.resourceRootDir, 'toc-editor.html'), 'utf-8')
  html = fixResourceReferences(panel.webview, html, context.resourceRootDir)
  html = fixCspSourceReferences(panel.webview, html)
  panel.webview.html = html
  return panel
}

export class TocEditorPanel extends Panel<PanelIncomingMessage, PanelOutgoingMessage> {
  constructor(private readonly context: ExtensionHostContext) {
    super(initPanel(context))

    this.registerDisposable(this.context.client.onRequest('onDidChangeWatchedFiles', async () => {
      await this.refreshPanel(this.panel, this.context.client)
    }))
  }

  readonly refreshPanel = refreshPanel
  readonly handleMessage = handleMessageFromWebviewPanel(this.panel, this.context.client)
}
