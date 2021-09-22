import fs from 'fs'
import path from 'path'
import vscode from 'vscode'

import { TreeItem as TreeItemUI } from 'react-sortable-tree'
import { fixResourceReferences, fixCspSourceReferences, getRootPathUri, expect, ensureCatch } from './utils'
import { ClientPageish, ClientTocNode, TocNodeKind, PageRenameEvent, SubbookRenameEvent, TocMoveEvent, TocRemoveEvent, TocModification, TocModificationKind } from '../../common/src/toc-tree'
import { PanelType } from './extension-types'
import { LanguageClient } from 'vscode-languageclient/node'
import { BookTocsArgs, DEFAULT_BOOK_TOCS_ARGS, ExtensionServerRequest, NewPageParams, NewSubbookParams, Opt } from '../../common/src/requests'
import { ExtensionHostContext, Panel } from './panel'

export const NS_COLLECTION = 'http://cnx.rice.edu/collxml'
export const NS_CNXML = 'http://cnx.rice.edu/cnxml'
export const NS_METADATA = 'http://cnx.rice.edu/mdml'

export interface ErrorSignal {
  type: 'error'
  message: string
}
export interface SubbookCreateSignal {
  type: 'SUBBOOK_CREATE'
  slug: string
  bookIndex: number
}
export interface PageCreateSignal {
  type: 'PAGE_CREATE'
  bookIndex: number
}
export interface TocMoveSignal {
  type: 'TOC_MOVE'
  event: TocMoveEvent
}
export interface TocRemoveSignal {
  type: 'TOC_REMOVE'
  event: TocRemoveEvent
}
export interface PageRenameSignal {
  type: 'PAGE_RENAME'
  event: PageRenameEvent
}
export interface SubbookRenameSignal {
  type: 'SUBBOOK_RENAME'
  event: SubbookRenameEvent
}
// export interface WebviewStartedSignal {
//   type: 'WEBVIEW_STARTED'
// }
export type PanelIncomingMessage = (
  | TocMoveSignal
  | TocRemoveSignal
  | PageRenameSignal
  | SubbookRenameSignal
  // | WebviewStartedSignal
  | ErrorSignal
  | SubbookCreateSignal
  | PageCreateSignal
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

const initPanel = (context: ExtensionHostContext): vscode.WebviewPanel => {
  const localResourceRoots = [vscode.Uri.file(context.resourceRootDir)]
  const workspaceRoot = getRootPathUri()
  /* istanbul ignore if */
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

const isWebviewDisposed = (panel: vscode.WebviewPanel) => {
  try {
    // This attempted access will throw if the panel is disposed
    /* eslint-disable-next-line @typescript-eslint/no-unused-expressions */
    panel.webview.html
    return false
  } catch {
    // Do no work if the panel is disposed
    return true
  }
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
    let event: Opt<TocModification>
    if (m.type === 'TOC_MOVE') {
      event = { ...m.event, type: TocModificationKind.Move }
    } else if (m.type === 'TOC_REMOVE') {
      event = { ...m.event, type: TocModificationKind.Remove }
    } else if (m.type === 'PAGE_RENAME') {
      event = { ...m.event, type: TocModificationKind.PageRename }
    } else if (m.type === 'SUBBOOK_RENAME') {
      event = { ...m.event, type: TocModificationKind.SubbookRename }
    } else if (m.type === 'PAGE_CREATE') {
      const title = await vscode.window.showInputBox({ prompt: 'Title of new Page' })
      /* istanbul ignore else */
      if (title !== undefined) {
        const params: NewPageParams = { workspaceUri, title, bookIndex: m.bookIndex }
        await this.context.client.sendRequest(ExtensionServerRequest.NewPage, params)
        return
      }
    } else /* istanbul ignore else */ if (m.type === 'SUBBOOK_CREATE') {
      const title = await vscode.window.showInputBox({ prompt: 'Title of new Book Section' })
      /* istanbul ignore else */
      if (title !== undefined) {
        const params: NewSubbookParams = { workspaceUri, title, bookIndex: m.bookIndex, slug: m.slug }
        await this.context.client.sendRequest(ExtensionServerRequest.NewSubbook, params)
        return
      }
    }
    /* istanbul ignore else */
    if (event !== undefined) {
      await this.context.client.sendRequest(ExtensionServerRequest.TocModification, { workspaceUri, event })
    }
  }

  async update(state: BookTocsArgs) {
    this.state = state
    /* istanbul ignore else */
    if (!isWebviewDisposed(this.panel)) {
      await this.panel.webview.postMessage(this.createMessage())
    }
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
    if (!isWebviewDisposed(panel)) {
      await panel.webview.postMessage(this.createMessage())
    }
  }
}
