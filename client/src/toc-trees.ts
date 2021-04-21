import vscode from 'vscode'
import { getRootPathUri, expect, constructCollectionUri, constructModuleUri } from './utils'
import { ExtensionServerRequest, BundleTreesResponse, BundleTreesArgs } from '../../common/src/requests'
import { TocTreeCollection, TocTreeElementType, TocTreeModule } from '../../common/src/toc-tree'
import { ExtensionHostContext } from './panel'

export class TocTreesProvider implements vscode.TreeDataProvider<TocTreeItem> {
  private readonly _onDidChangeTreeData: vscode.EventEmitter<TocTreeItem | undefined> = new vscode.EventEmitter<TocTreeItem | undefined>()
  readonly onDidChangeTreeData: vscode.Event<TocTreeItem | undefined> = this._onDidChangeTreeData.event

  constructor(private readonly context: ExtensionHostContext) {
    this.context.events.onDidChangeWatchedFiles(this.refresh.bind(this))
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined)
  }

  getTreeItem(element: TocTreeItem): TocTreeItem {
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
}

export class TocTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly children: TocTreeItem[],
    public readonly command?: vscode.Command,
    public readonly description?: string
  ) {
    super(label, collapsibleState)
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
