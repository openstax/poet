import fs from 'fs'
import path from 'path'
import vscode from 'vscode'

import { TreeItem as TreeItemUI } from 'react-sortable-tree'
import { fixResourceReferences, fixCspSourceReferences, getRootPathUri, expect, ensureCatch } from './utils'
import { ClientPageish, ClientTocNode, TocNodeKind, PageRenameEvent, SubbookRenameEvent, TocMoveEvent, TocRemoveEvent, CreatePageEvent, CreateSubbookEvent, TocModification, TocModificationKind, TocModificationParams } from './common/toc'
import { PanelType } from './extension-types'
import { LanguageClient } from 'vscode-languageclient/node'
import { BooksAndOrphans, EMPTY_BOOKS_AND_ORPHANS, ExtensionServerRequest, Opt } from './common/requests'
import { ExtensionHostContext, Panel } from './panel'

export const NS_COLLECTION = 'http://cnx.rice.edu/collxml'
export const NS_CNXML = 'http://cnx.rice.edu/cnxml'
export const NS_METADATA = 'http://cnx.rice.edu/mdml'

export interface ErrorSignal {
  type: 'error'
  message: string
}
export type PanelIncomingMessage = (
  | TocMoveEvent
  | TocRemoveEvent
  | PageRenameEvent
  | SubbookRenameEvent
  | CreateSubbookEvent
  | CreatePageEvent
  | ErrorSignal
)

export type TreeItemWithToken = TreeItemUI & ({
  type: TocNodeKind.Page
  token: string
  title: string | undefined
  fileId: string
  absPath: string
} | {
  type: TocNodeKind.Subbook
  token: string
  title: string
  children: TreeItemWithToken[]
})
export interface Bookish {
  title: string
  slug: string
  tocTree: TreeItemWithToken[]
}
export interface PanelState {
  uneditable: Bookish[]
  editable: Bookish[]
}

function toTreeItem(n: ClientTocNode): TreeItemWithToken {
  if (n.type === TocNodeKind.Page) {
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
const toClientTocNode = (n: ClientPageish): ClientTocNode => ({ type: TocNodeKind.Page, value: n })
export class TocEditorPanel extends Panel<PanelIncomingMessage, never, PanelState> {
  private state = EMPTY_BOOKS_AND_ORPHANS
  constructor(private readonly context: ExtensionHostContext) {
    super(initPanel(context))

    this.state = context.bookTocs

    this.registerDisposable(this.context.events.onDidChangeWatchedFiles(ensureCatch(async () => {
      await this.refreshPanel(this.panel, this.context.client)
    })))

    let html = fs.readFileSync(path.join(context.resourceRootDir, 'toc-editor.html'), 'utf-8')
    html = fixResourceReferences(this.panel.webview, html, context.resourceRootDir)
    html = fixCspSourceReferences(this.panel.webview, html)
    html = this.injectInitialState(html, this.getState())
    this.panel.webview.html = html
  }

  // readonly handleMessage = handleMessageFromWebviewPanel(this.panel, this.context.client)
  readonly handleMessage = async (m: PanelIncomingMessage) => {
    const workspaceUri = expect(getRootPathUri(), 'No root path in which to generate a module').toString()
    let event: Opt<TocModification|CreatePageEvent|CreateSubbookEvent>
    if (m.type === TocModificationKind.Move || m.type === TocModificationKind.Remove || m.type === TocModificationKind.PageRename || m.type === TocModificationKind.SubbookRename) {
      event = m
    } else if (m.type === TocNodeKind.Page) {
      const title = await vscode.window.showInputBox({ prompt: 'Title of new Page' })
      /* istanbul ignore if */
      if (title === undefined) {
        return
      } else {
        event = { ...m, title }
      }
    } else /* istanbul ignore else */ if (m.type === TocNodeKind.Subbook) {
      const title = await vscode.window.showInputBox({ prompt: 'Title of new Book Section' })
      /* istanbul ignore if */
      if (title === undefined) {
        return
      } else {
        event = { ...m, title }
      }
    }
    /* istanbul ignore else */
    if (event !== undefined) {
      const params: TocModificationParams = { workspaceUri, event }
      await this.context.client.sendRequest(ExtensionServerRequest.TocModification, params)
    }
  }

  async update(state: BooksAndOrphans) {
    this.state = state
    /* istanbul ignore else */
    if (!isWebviewDisposed(this.panel)) {
      await this.sendState()
    }
  }

  protected getState(): PanelState {
    const allModules = new Set<ClientPageish>()
    function recAddModules(n: ClientTocNode) {
      if (n.type === TocNodeKind.Page) {
        allModules.add(n.value)
      } else {
        n.children.forEach(recAddModules)
      }
    }
    this.state.books.forEach(b => b.tocTree.forEach(recAddModules))
    const orphanModules = this.state.orphans

    const allModulesSorted = Array.from(allModules).sort(fileIdSorter)
    const orphanModulesSorted = orphanModules.sort(fileIdSorter)
    const bookAllModules = {
      title: 'All Modules',
      slug: 'mock-slug__source-only',
      tocTree: allModulesSorted.map(toClientTocNode).map(toTreeItem)
    }
    const bookOrphanModules = {
      title: 'Orphan Modules',
      slug: 'mock-slug__source-only',
      tocTree: orphanModulesSorted.map(toClientTocNode).map(toTreeItem)
    }
    return {
      uneditable: [bookAllModules, bookOrphanModules],
      editable: this.state.books.map(b => ({ ...b, tocTree: b.tocTree.map(toTreeItem) }))
    }
  }

  async refreshPanel(panel: vscode.WebviewPanel, client: LanguageClient): Promise<void> {
    if (!isWebviewDisposed(panel)) {
      await this.sendState()
    }
  }
}
