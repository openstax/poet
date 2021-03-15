import vscode from 'vscode'
import fs, { promises as fsPromises } from 'fs'
import path from 'path'

import xmlFormat from 'xml-formatter'
import { DOMParser, XMLSerializer } from 'xmldom'
import { fixResourceReferences, fixCspSourceReferences, getRootPathUri, expect, ensureCatch } from './utils'
import { PanelType } from './extension-types'
import { LanguageClient } from 'vscode-languageclient/node'

export const NS_COLLECTION = 'http://cnx.rice.edu/collxml'
export const NS_CNXML = 'http://cnx.rice.edu/cnxml'
export const NS_METADATA = 'http://cnx.rice.edu/mdml'

export interface TocTreeModule {
  type: 'module'
  moduleid: string
  title: string
  subtitle?: string
}

export interface TocTreeCollection {
  type: 'collection' | 'subcollection'
  title: string
  slug?: string
  expanded?: boolean
  children: TocTreeElement[]
}

export type TocTreeElement = TocTreeModule | TocTreeCollection

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

/**
 * Guess all module titles by reading the modules asynchronously and
 * just looking for the title tag with a specific namespace prefix.
 * This can yield incomplete results, but is about 50x faster than
 * preloading the module titles via parsing individual modules as XML
 */
async function guessModuleTitles(): Promise<Map<string, string>> {
  const results = new Map<string, string>()
  const uri = getRootPathUri()
  if (uri == null) {
    return results
  }
  const moduleDirs = await fsPromises.readdir(path.join(uri.fsPath, 'modules'))

  const guessFromDir = async (moduleDir: string): Promise<[string, string] | null> => {
    const module = uri.with({ path: path.join(uri.path, 'modules', moduleDir, 'index.cnxml') })
    const xml = await fsPromises.readFile(module.fsPath, { encoding: 'utf-8' })
    const titleTagStart = xml.indexOf('<md:title>')
    const titleTagEnd = xml.indexOf('</md:title>')
    if (titleTagStart === -1 || titleTagEnd === -1) {
      return null
    }
    const actualTitleStart = titleTagStart + 10 // Add length of '<md:title>'
    if (titleTagEnd - actualTitleStart > 280) {
      // If the title is so long you can't tweet it,
      // then something probably went wrong.
      return null
    }
    const moduleTitle = xml.substring(actualTitleStart, titleTagEnd).trim()
    return [moduleDir, moduleTitle]
  }

  const promises = []
  for (const moduleDir of moduleDirs) {
    promises.push(guessFromDir(moduleDir))
  }

  for (const result of await Promise.all(promises)) {
    if (result == null) {
      continue
    }
    results.set(result[0], result[1])
  }
  return results
}

export const showTocEditor = (panelType: PanelType, resourceRootDir: string, activePanelsByType: {[key in PanelType]?: vscode.WebviewPanel}, client: LanguageClient) => async () => {
  const panel = vscode.window.createWebviewPanel(
    panelType,
    'Table of Contents Editor',
    vscode.ViewColumn.One,
    {
      enableScripts: true
    }
  )

  let html = fs.readFileSync(path.join(resourceRootDir, 'toc-editor.html'), 'utf-8')
  html = fixResourceReferences(panel.webview, html, resourceRootDir)
  html = fixCspSourceReferences(panel.webview, html)
  panel.webview.html = html

  panel.reveal(vscode.ViewColumn.One)
  activePanelsByType[panelType] = panel

  panel.webview.onDidReceiveMessage(ensureCatch(handleMessage(panel, client)))

  // Setup an occasional refresh to remain reactive to unhandled events
  // const autoRefresh = setInterval(() => {
  //   handleMessage(panel)({ type: 'refresh' })
  //     // eslint-disable-next-line node/handle-callback-err
  //     .catch(err => {
  //       // Panel was probably disposed
  //       clearInterval(autoRefresh)
  //     })
  // }, 1000)
}

export const handleMessage = (panel: vscode.WebviewPanel, client: LanguageClient) => async (message: PanelIncomingMessage): Promise<void> => {
  const refreshPanel = async (): Promise<void> => {
    const uri = expect(getRootPathUri(), 'no workspace root from which to generate trees')
    const trees = await client.sendRequest('repo-trees', { workspaceUri: uri.toString() })
    console.log(trees)
    const allModules: TocTreeModule[] = await client.sendRequest('repo-modules', { workspaceUri: uri.toString(), asTreeObjects: true })
    const orphanModules: TocTreeModule[] = await client.sendRequest('repo-orphan-modules', { workspaceUri: uri.toString(), asTreeObjects: true })
    const collectionAllModules: TocTreeCollection = {
      type: 'collection',
      title: 'All Modules',
      slug: 'mock-slug__source-only',
      children: allModules.sort((m, n) => m.moduleid.localeCompare(n.moduleid))
    }
    const collectionOrphanModules: TocTreeCollection = {
      type: 'collection',
      title: 'Orphan Modules',
      slug: 'mock-slug__source-only',
      children: orphanModules.sort((m, n) => m.moduleid.localeCompare(n.moduleid))
    }
    const out = {
      uneditable: [collectionAllModules, collectionOrphanModules],
      editable: trees
    }
    await panel.webview.postMessage(out)
  }
  if (message.type === 'refresh') {
    await refreshPanel()
  } else if (message.type === 'error') {
    throw new Error(message.message)
  } else if (message.type === 'debug') {
    console.debug(message.item)
  } else if (message.type === 'module-create') {
    await createBlankModule()
    // await refreshPanel()
  } else if (message.type === 'subcollection-create') {
    await createSubcollection(message.slug)
    // await refreshPanel()
  } else if (message.type === 'module-rename') {
    const { moduleid, newName } = message
    await renameModule(moduleid, newName)
    // await refreshPanel()
  } else if (message.type === 'write-tree') {
    await writeTree(message.treeData)
  } else {
    throw new Error(`Unexpected signal: ${JSON.stringify(message)}`)
  }
}

async function workspaceToTrees(): Promise<PanelOutgoingMessage> {
  const guessedModuleTitles = await guessModuleTitles()
  const uri = expect(getRootPathUri(), 'no workspace root from which to generate trees')

  const getModuleTitle = (moduleid: string): string => {
    const titleFromCache = guessedModuleTitles.get(moduleid)
    if (titleFromCache != null) {
      return titleFromCache
    }
    const module = uri.with({ path: path.join(uri.path, 'modules', moduleid, 'index.cnxml') })
    const xml = fs.readFileSync(module.fsPath, { encoding: 'utf-8' })
    const document = new DOMParser().parseFromString(xml)
    try {
      const metadata = document.getElementsByTagNameNS(NS_CNXML, 'metadata')[0]
      const moduleTitle = metadata.getElementsByTagNameNS(NS_METADATA, 'title')[0].textContent
      return moduleTitle ?? 'Unnamed Module'
    } catch {
      return 'Unnamed Module'
    }
  }

  const moduleObjectFromModuleId = (moduleid: string): TocTreeModule => {
    return {
      type: 'module',
      moduleid: moduleid,
      title: getModuleTitle(moduleid),
      subtitle: moduleid
    }
  }

  const collectionFiles = fs.readdirSync(path.join(uri.fsPath, 'collections'))
  const collectionTrees = []
  for (const collectionFile of collectionFiles) {
    const collectionData = fs.readFileSync(path.join(uri.fsPath, 'collections', collectionFile), { encoding: 'utf-8' })
    collectionTrees.push(parseCollection(collectionData, moduleObjectFromModuleId))
  }
  // Some special non-editable collections
  const allModules = fs.readdirSync(path.join(uri.fsPath, 'modules'))
  const usedModules: string[] = []
  for (const collectionTree of collectionTrees) {
    insertUsedModules(usedModules, collectionTree)
  }
  const usedModulesSet = new Set(usedModules)
  const orphanModules = allModules.filter(x => !usedModulesSet.has(x))
  const collectionAllModules: TocTreeCollection = {
    type: 'collection',
    title: 'All Modules',
    slug: 'mock-slug__source-only',
    children: allModules.map(moduleObjectFromModuleId).sort((m, n) => m.moduleid.localeCompare(n.moduleid))
  }
  const collectionOrphanModules: TocTreeCollection = {
    type: 'collection',
    title: 'Orphan Modules',
    slug: 'mock-slug__source-only',
    children: orphanModules.map(moduleObjectFromModuleId).sort((m, n) => m.moduleid.localeCompare(n.moduleid))
  }

  return {
    uneditable: [collectionAllModules, collectionOrphanModules],
    editable: collectionTrees
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

function insertUsedModules(arr: string[], tree: TocTreeElement): void {
  if (tree.type === 'module') {
    arr.push(tree.moduleid)
  } else {
    for (const child of tree.children) {
      insertUsedModules(arr, child)
    }
  }
}

function parseCollection(xml: string, moduleObjectResolver: (id: string) => TocTreeModule): TocTreeCollection {
  const document = new DOMParser().parseFromString(xml)

  const metadata = document.getElementsByTagNameNS(NS_COLLECTION, 'metadata')[0]
  const collectionTitle = metadata.getElementsByTagNameNS(NS_METADATA, 'title')[0].textContent
  const collectionSlug = metadata.getElementsByTagNameNS(NS_METADATA, 'slug')[0].textContent

  const treeRoot = document.getElementsByTagNameNS(NS_COLLECTION, 'content')[0]

  const moduleToObject = (element: any): TocTreeModule => {
    const moduleid = element.getAttribute('document')
    return moduleObjectResolver(expect(moduleid, 'Module ID missing'))
  }

  const subcollectionToObject = (element: any): TocTreeCollection => {
    const title = element.getElementsByTagNameNS(NS_METADATA, 'title')[0].textContent
    const content = element.getElementsByTagNameNS(NS_COLLECTION, 'content')[0]
    return {
      type: 'subcollection',
      title: expect(title, 'Subcollection title missing'),
      children: childObjects(content)
    }
  }

  const childObjects = (element: any): TocTreeElement[] => {
    const children = []
    for (const child of Array.from<any>(element.childNodes)) {
      if (child.localName === 'module') {
        children.push(moduleToObject(child))
      } else if (child.localName === 'subcollection') {
        children.push(subcollectionToObject(child))
      }
    }
    return children
  }

  return {
    type: 'collection',
    title: expect(collectionTitle, 'Collection title missing'),
    slug: expect(collectionSlug, 'Collection slug missing'),
    children: childObjects(treeRoot)
  }
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
  expect(content.parentNode).replaceChild(newContent, content)
  populateTreeDataToXML(document, newContent, treeData)
}
