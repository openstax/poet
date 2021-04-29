import vscode from 'vscode'
import { getRootPathUri, expect, constructCollectionUri, constructModuleUri } from './utils'
import { ExtensionServerRequest, BundleTreesResponse, BundleTreesArgs } from '../../common/src/requests'
import { TocTreeCollection, TocTreeElementType, TocTreeModule } from '../../common/src/toc-tree'
import { ExtensionHostContext } from './panel'

export class TocTreesProvider implements vscode.TreeDataProvider<TocTreeItem> {
  private readonly _onDidChangeTreeData: vscode.EventEmitter<TocTreeItem | undefined> = new vscode.EventEmitter<TocTreeItem | undefined>()
  readonly onDidChangeTreeData: vscode.Event<TocTreeItem | undefined> = this._onDidChangeTreeData.event
  private isFilterMode = false

  constructor(private readonly context: ExtensionHostContext) {
    this.context.events.onDidChangeWatchedFiles(this.refresh.bind(this))
  }

  toggleFilterMode(): void {
    this.isFilterMode = !this.isFilterMode
    this.refresh()
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined)
  }

  getTreeItem(element: TocTreeItem): TocTreeItem {
    if (this.isFilterMode && (element.description != null)) {
      return new TocTreeItem(
        `${element.label} (${element.description})`,
        element.collapsibleState,
        element.children,
        element.command,
        undefined
      )
    }
    return element
  }

  private async queryBundleTrees(args: BundleTreesArgs): Promise<BundleTreesResponse> {
    return await this.context.client.sendRequest(ExtensionServerRequest.BundleTrees, args)
  }

  async getChildren(element?: TocTreeItem): Promise<TocTreeItem[]> {
    if (element !== undefined) {
      return element.children
    }

    const uri = expect(getRootPathUri(), 'No workspace root for ToC trees')
    const bundleTrees: BundleTreesResponse = await this.queryBundleTrees(
      { workspaceUri: uri.toString() }
    )
    if (bundleTrees == null) {
      return []
    }

    const children: TocTreeItem[] = []
    bundleTrees.forEach(collection => {
      children.push(TocTreeItem.fromCollection(collection, uri))
    })
    return children
  }

  getParent(element: TocTreeItem): vscode.ProviderResult<TocTreeItem> {
    return element.parent
  }
}

export class TocTreeItem extends vscode.TreeItem {
  parent: TocTreeItem | undefined = undefined

  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly children: TocTreeItem[],
    public readonly command?: vscode.Command,
    public readonly description?: string
  ) {
    super(label, collapsibleState)
    this.children.forEach(child => { child.parent = this })
  }

  static fromCollection(treeCollection: TocTreeCollection, workspaceUri: vscode.Uri): TocTreeItem {
    const collapsibleState = vscode.TreeItemCollapsibleState.Collapsed
    const children: TocTreeItem[] = []

    treeCollection.children.forEach(element => {
      if (element.type === TocTreeElementType.module) {
        children.push(TocTreeItem.fromModule(element, workspaceUri))
      } else {
        children.push(TocTreeItem.fromCollection(element, workspaceUri))
      }
    })

    if ((treeCollection.type === TocTreeElementType.subcollection) || (treeCollection.slug == null)) {
      return new TocTreeItem(treeCollection.title, collapsibleState, children)
    }

    return new TocTreeItem(
      treeCollection.title,
      collapsibleState,
      children,
      { title: 'open', command: 'vscode.open', arguments: [constructCollectionUri(workspaceUri, treeCollection.slug)] }
    )
  }

  static fromModule(treeModule: TocTreeModule, workspaceUri: vscode.Uri): TocTreeItem {
    return new TocTreeItem(
      treeModule.title,
      vscode.TreeItemCollapsibleState.None,
      [],
      { title: 'open', command: 'vscode.open', arguments: [constructModuleUri(workspaceUri, treeModule.moduleid)] },
      treeModule.moduleid
    )
  }
}

export function toggleTocTreesFilteringHandler(view: vscode.TreeView<TocTreeItem>, provider: TocTreesProvider): () => Promise<void> {
  let revealing: boolean = false

  // We call the view.reveal API for all nodes with children to ensure the tree
  // is fully expanded. This approach is used since attempting to simply call
  // reveal on root notes with the max expand value of 3 doesn't seem to always
  // fully expose leaf nodes for large trees.

  async function revealer(elements: TocTreeItem[]): Promise<void> {
    for (const el of elements) {
      if (el.children.length !== 0) {
        await view.reveal(el, { expand: true })
        await revealer(el.children)
      }
    }
  }

  return async () => {
    // Avoid parallel processing of requests by ignoring if we're actively
    // revealing
    if (revealing) { return }
    revealing = true

    try {
      // Toggle data provider filter mode and reveal all children so the
      // tree expands if it hasn't already
      provider.toggleFilterMode()
      const children = await provider.getChildren()
      await revealer(children)
    } finally {
      revealing = false
    }
  }
}
