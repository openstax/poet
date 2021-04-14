import vscode from 'vscode'
import { LanguageClient } from 'vscode-languageclient/node'
import { getRootPathUri, expect, constructCollectionUri, constructModuleUri } from './utils'
import { ExtensionServerRequest, BundleTreesResponse, BundleTreesArgs } from '../../common/src/requests'
import { TocTreeCollection, TocTreeElementType, TocTreeModule } from '../../common/src/toc-tree'

export class TocTreesProvider implements vscode.TreeDataProvider<TocTreeItem> {
  private readonly _onDidChangeTreeData: vscode.EventEmitter<TocTreeItem | undefined > = new vscode.EventEmitter<TocTreeItem | undefined >()
  readonly onDidChangeTreeData: vscode.Event<TocTreeItem | undefined > = this._onDidChangeTreeData.event
  private isFilterMode = false

  constructor(private readonly client: LanguageClient) {
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
    return await this.client.sendRequest(ExtensionServerRequest.BundleTrees, args)
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
  return async () => {
    provider.toggleFilterMode()
    const children = await provider.getChildren()
    for (const child of children) {
      await view.reveal(child, { expand: 3 })
      // TODO: Refreshing here on each iteration is excessive, but this seems
      // to be the only way that large trees consistently expand all the way.
      // Need to either correct this or fully understand why the udnerlying
      // implementation necessitates doing it.
      provider.refresh()
    }
  }
}
