import fs from 'fs'
import path from 'path'
import vscode from 'vscode'

import { TreeItem as TreeItemUI } from 'react-sortable-tree'
import { fixResourceReferences, fixCspSourceReferences, getRootPathUri, expect, ensureCatch } from './utils'
import { BookToc, ClientPageish, ClientTocNode, TocNodeKind, PageRenameEvent, SubbookRenameEvent, TocMoveEvent, TocRemoveEvent, TocModification, TocModificationKind } from '../../common/src/toc-tree'
import { PanelType } from './extension-types'
import { LanguageClient } from 'vscode-languageclient/node'
import { BookTocsArgs, DEFAULT_BOOK_TOCS_ARGS, ExtensionServerRequest, Opt } from '../../common/src/requests'
import { ExtensionHostContext, Panel } from './panel'

export const NS_COLLECTION = 'http://cnx.rice.edu/collxml'
export const NS_CNXML = 'http://cnx.rice.edu/cnxml'
export const NS_METADATA = 'http://cnx.rice.edu/mdml'

export interface DebugSignal {
  type: 'DEBUG'
  message: any
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
  treeData: BookToc
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
export interface TocMoveSignal {
  type: 'TOC_MOVE'
  event: TocMoveEvent<TreeItemWithToken>
}
export interface TocRemoveSignal {
  type: 'TOC_REMOVE'
  event: TocRemoveEvent<TreeItemWithToken>
}
export interface PageRenameSignal {
  type: 'PAGE_RENAME'
  event: PageRenameEvent<TreeItemWithToken>
}
export interface SubbookRenameSignal {
  type: 'SUBBOOK_RENAME'
  event: SubbookRenameEvent<TreeItemWithToken>
}
// export interface WebviewStartedSignal {
//   type: 'WEBVIEW_STARTED'
// }
export type PanelIncomingMessage = (
  DebugSignal
  | TocMoveSignal
  | TocRemoveSignal
  | PageRenameSignal
  | SubbookRenameSignal
  // | WebviewStartedSignal
  | RefreshSignal
  | ErrorSignal
  | WriteTreeSignal
  | SubcollectionCreateSignal
  | ModuleCreateSignal
  | ModuleRenameSignal
)

type TreeItemWithToken = TreeItemUI & ({
  type: TocNodeKind.Leaf
  token: string
  title: string | undefined
  fileId: string
  absPath: string
} | {
  type: TocNodeKind.Inner
  token: string
  title: string
  children: TreeItemWithToken[]
})
interface Bookish {
  title: string
  slug: string
  tree: TreeItemWithToken[]
}
export interface PanelOutgoingMessage {
  uneditable: Bookish[]
  editable: Bookish[]
}

// async function createBlankModule(): Promise<string> {
//   const template = (newModuleId: string): string => {
//     return `
// <document xmlns="http://cnx.rice.edu/cnxml">
//   <title>New Module</title>
//   <metadata xmlns:md="http://cnx.rice.edu/mdml">
//     <md:title>New Module</md:title>
//     <md:content-id>${newModuleId}</md:content-id>
//     <md:uuid>${uuidv4()}</md:uuid>
//   </metadata>
//   <content>
//   </content>
// </document>`.trim()
//   }
//   const uri = expect(getRootPathUri(), 'No root path in which to generate a module')
//   let moduleNumber = 0
//   const moduleDirs = new Set(await fsPromises.readdir(path.join(uri.fsPath, 'modules')))
//   while (true) {
//     moduleNumber += 1
//     const newModuleId = `m${moduleNumber.toString().padStart(5, '0')}`
//     if (moduleDirs.has(newModuleId)) {
//       // File exists already, try again
//       continue
//     }
//     const newModuleUri = constructModuleUri(uri, newModuleId)
//     await vscode.workspace.fs.writeFile(newModuleUri, Buffer.from(template(newModuleId)))
//     return newModuleId
//   }
// }

// async function createSubcollection(slug: string): Promise<void> {
//   const uri = expect(getRootPathUri(), 'no root path found in which to write tree')
//   const replacingUri = constructCollectionUri(uri, slug)
//   const collectionData = fs.readFileSync(replacingUri.fsPath, { encoding: 'utf-8' })
//   const document = new DOMParser().parseFromString(collectionData)
//   const contentRoot = document.getElementsByTagNameNS(NS_COLLECTION, 'content')[0]
//   // make a fake tree data collection to populate the new subcollection to the content root
//   populateTreeDataToXML(document, contentRoot, {
//     type: TocTreeElementType.collection,
//     title: 'fake',
//     children: [{
//       type: TocTreeElementType.subcollection,
//       title: 'New Subcollection',
//       children: []
//     }]
//   })
//   const serailizedXml = xmlFormat(new XMLSerializer().serializeToString(document), {
//     indentation: '  ',
//     collapseContent: true,
//     lineSeparator: '\n'
//   })
//   await vscode.workspace.fs.writeFile(replacingUri, Buffer.from(serailizedXml))
// }

// async function renameModule(id: string, newName: string): Promise<void> {
//   const uri = expect(getRootPathUri(), 'No root path in which to find renamed module')
//   const moduleUri = constructModuleUri(uri, id)
//   const xml = Buffer.from(await vscode.workspace.fs.readFile(moduleUri)).toString('utf-8')
//   const document = new DOMParser().parseFromString(xml)

//   // Change title in metadata
//   let metadata = document.getElementsByTagNameNS(NS_CNXML, 'metadata')[0]
//   if (metadata == null) {
//     const root = document.getElementsByTagNameNS(NS_CNXML, 'document')[0]
//     metadata = document.createElementNS(NS_CNXML, 'metadata')
//     root.appendChild(metadata)
//   }
//   let metaTitleElement = metadata.getElementsByTagNameNS(NS_METADATA, 'title')[0]
//   if (metaTitleElement == null) {
//     metaTitleElement = document.createElementNS(NS_METADATA, 'md:title')
//     metadata.appendChild(metaTitleElement)
//   }
//   metaTitleElement.textContent = newName

//   // Change title in document
//   let titleElement = document.getElementsByTagNameNS(NS_CNXML, 'title')[0]
//   if (titleElement == null) {
//     titleElement = document.createElementNS(NS_CNXML, 'title')
//     document.insertBefore(titleElement, metadata)
//   }
//   titleElement.textContent = newName

//   const newData = new XMLSerializer().serializeToString(document)
//   await vscode.workspace.fs.writeFile(moduleUri, Buffer.from(newData))
// }

// export const handleMessageFromWebviewPanel = (panel: vscode.WebviewPanel, client: LanguageClient) => async (message: PanelIncomingMessage): Promise<void> => {
//   if (message.type === 'refresh') {
//     await refreshPanel(panel, client)
//   } else if (message.type === 'error') {
//     throw new Error(message.message)
//   } else if (message.type === 'debug') {
//     // For debugging purposes only
//     /* istanbul ignore next */
//     console.debug(message.item)
//   } else if (message.type === 'module-create') {
//     await createBlankModule()
//   } else if (message.type === 'subcollection-create') {
//     await createSubcollection(message.slug)
//   } else if (message.type === 'module-rename') {
//     const { moduleid, newName } = message
//     await renameModule(moduleid, newName)
//   } else if (message.type === 'write-tree') {
//     await writeTree(message.treeData)
//   } else {
//     throw new Error(`Unexpected signal: ${JSON.stringify(message)}`)
//   }
// }

// async function writeTree(treeData: TocTreeCollection): Promise<void> {
//   const uri = expect(getRootPathUri(), 'no root path found in which to write tree')
//   const slug = expect(treeData.slug, 'attempted to write tree with no slug')
//   const replacingUri = uri.with({ path: path.join(uri.fsPath, 'collections', `${slug}.collection.xml`) })
//   const collectionData = fs.readFileSync(replacingUri.fsPath, { encoding: 'utf-8' })
//   const document = new DOMParser().parseFromString(collectionData)
//   replaceCollectionContent(document, treeData)
//   const serailizedXml = xmlFormat(new XMLSerializer().serializeToString(document), {
//     indentation: '  ',
//     collapseContent: true,
//     lineSeparator: '\n'
//   })
//   await vscode.workspace.fs.writeFile(replacingUri, Buffer.from(serailizedXml))
// }

// function populateTreeDataToXML(document: XMLDocument, root: any, treeData: TocTreeCollection): void {
//   for (const child of treeData.children) {
//     const element = document.createElementNS(NS_COLLECTION, child.type)
//     // md prefix is technically a guess. If incorrect, document may have a lot of xmlns:md attributes
//     const title = document.createElementNS(NS_METADATA, 'md:title')
//     const titleContent = document.createTextNode(child.title)
//     title.appendChild(titleContent)
//     root.appendChild(element)
//     if (child.type === TocTreeElementType.subcollection) {
//       element.appendChild(title)
//       const contentWrapper = document.createElementNS(NS_COLLECTION, 'content')
//       element.appendChild(contentWrapper)
//       populateTreeDataToXML(document, contentWrapper, child)
//     } else if (child.type === TocTreeElementType.module) {
//       element.setAttribute('document', child.moduleid)
//     }
//   }
// }

// function replaceCollectionContent(document: XMLDocument, treeData: TocTreeCollection): void {
//   const content = document.getElementsByTagNameNS(NS_COLLECTION, 'content')[0]

//   const newContent = document.createElementNS(NS_COLLECTION, 'content')
//   expect(content.parentNode, 'expected a parent element').replaceChild(newContent, content)
//   populateTreeDataToXML(document, newContent, treeData)
// }

function toTreeItem(n: ClientTocNode): TreeItemWithToken {
  if (n.type === TocNodeKind.Leaf) {
    return {
      type: n.type,
      token: n.value.token,
      title: n.value.title,
      subtitle: n.value.fileId,
      fileId: n.value.fileId,
      absPath: n.value.absPath
    }
  } else {
    return {
      type: n.type,
      token: n.value.token,
      title: n.value.title,
      children: n.children.map(toTreeItem)
    }
  }
}

function fromTreeItem(n: TreeItemWithToken): ClientTocNode {
  if (n.type === TocNodeKind.Leaf) {
    return {
      type: n.type,
      value: {
        token: n.token,
        title: n.title,
        fileId: n.fileId,
        absPath: n.absPath
      }
    }
  } else {
    return {
      type: n.type,
      value: {
        token: n.token,
        title: n.title
      },
      children: n.children.map(fromTreeItem)
    }
  }
}

const initPanel = (context: ExtensionHostContext): vscode.WebviewPanel => {
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
  return panel
}

const fileIdSorter = (n1: ClientPageish, n2: ClientPageish) => n1.fileId.localeCompare(n2.fileId)
const toClientTocNode = (n: ClientPageish): ClientTocNode => ({ type: TocNodeKind.Leaf, value: n })
export class TocEditorPanel extends Panel<PanelIncomingMessage, PanelOutgoingMessage> {
  private state = DEFAULT_BOOK_TOCS_ARGS
  constructor(private readonly context: ExtensionHostContext) {
    super(initPanel(context))

    this.state = context.bookTocs

    this.registerDisposable(this.context.events.onDidChangeWatchedFiles(ensureCatch(async () => {
      await this.refreshPanel(this.panel, this.context.client)
    })))

    let html = fs.readFileSync(path.join(context.resourceRootDir, 'toc-editor.html'), 'utf-8')
    html = fixResourceReferences(this.panel.webview, html, context.resourceRootDir)
    html = fixCspSourceReferences(this.panel.webview, html)
    html = this.injectEnsuredMessages(html, [this.createMessage()])
    this.panel.webview.html = html
  }

  // readonly handleMessage = handleMessageFromWebviewPanel(this.panel, this.context.client)
  readonly handleMessage = async (m: PanelIncomingMessage) => {
    const workspaceUri = expect(getRootPathUri(), 'No root path in which to generate a module').toString()
    let event: Opt<TocModification<ClientTocNode>>
    if (m.type === 'TOC_MOVE') {
      event = { ...m.event, newToc: m.event.newToc.map(fromTreeItem), type: TocModificationKind.Move }
    } else if (m.type === 'TOC_REMOVE') {
      event = { ...m.event, newToc: m.event.newToc.map(fromTreeItem), type: TocModificationKind.Remove }
    } else if (m.type === 'PAGE_RENAME') {
      event = { ...m.event, newToc: m.event.newToc.map(fromTreeItem), node: fromTreeItem(m.event.node), type: TocModificationKind.PageRename }
    } else if (m.type === 'SUBBOOK_RENAME') {
      event = { ...m.event, newToc: m.event.newToc.map(fromTreeItem), node: fromTreeItem(m.event.node), type: TocModificationKind.SubbookRename }
    // } else if (m.type === 'WEBVIEW_LOADED') {
    // } else if (m.type === 'DEBUG') {
    //   console.log('DEBUG', m.message)
    } else {
      throw new Error(`Unknown Message type: ${m.type}`)
    }
    if (event !== undefined) {
      await this.context.client.sendRequest(ExtensionServerRequest.TocModification, { workspaceUri, event })
    }
  }

  async update(state: BookTocsArgs) {
    this.state = state
    await this.panel.webview.postMessage(this.createMessage())
  }

  private createMessage(): PanelOutgoingMessage {
    const allModules = new Set<ClientPageish>()
    function recAddModules(n: ClientTocNode) {
      if (n.type === TocNodeKind.Leaf) {
        allModules.add(n.value)
      } else {
        n.children.forEach(recAddModules)
      }
    }
    this.state.books.forEach(b => b.tree.forEach(recAddModules))
    const orphanModules = this.state.orphans

    const allModulesSorted = Array.from(allModules).sort(fileIdSorter)
    const orphanModulesSorted = orphanModules.sort(fileIdSorter)
    const collectionAllModules = {
      title: 'All Modules',
      slug: 'mock-slug__source-only',
      tree: allModulesSorted.map(toClientTocNode).map(toTreeItem)
    }
    const collectionOrphanModules = {
      title: 'Orphan Modules',
      slug: 'mock-slug__source-only',
      tree: orphanModulesSorted.map(toClientTocNode).map(toTreeItem)
    }
    return {
      uneditable: [collectionAllModules, collectionOrphanModules],
      editable: this.state.books.map(b => ({ ...b, tree: b.tree.map(toTreeItem) }))
    }
  }

  async refreshPanel(panel: vscode.WebviewPanel, client: LanguageClient): Promise<void> {
    try {
      // This attempted access will throw if the panel is disposed
      /* eslint-disable-next-line @typescript-eslint/no-unused-expressions */
      panel.webview.html
    } catch {
      // Do no work if the panel is disposed
      return
    }

    await panel.webview.postMessage(this.createMessage())
  }
}
