import vscode from 'vscode'
import { LanguageClient } from 'vscode-languageclient/node'
import { getRootPathUri, expect } from './utils'
import { ExtensionServerRequest, BundleTreesResponse } from '../../common/src/requests'
import { TocTreeCollection, TocTreeElementType, TocTreeModule } from '../../common/src/toc-tree'

export class ToCTreesProvider implements vscode.TreeDataProvider<TocTreeItem> {
  constructor(private readonly client: LanguageClient) {
  }

  getTreeItem(element: TocTreeItem): TocTreeItem {
    return element
  }

  async getChildren(element?: TocTreeItem): Promise<TocTreeItem[]> {
    const uri = expect(getRootPathUri(), 'No workspace root for ToC trees')
    const bundleTrees: BundleTreesResponse = await this.client.sendRequest(
      ExtensionServerRequest.BundleTrees,
      { workspaceUri: uri.toString() }
    )
    if (bundleTrees == null) {
      return []
    }

    if (element === undefined) {
      const children: TocTreeItem[] = []
      bundleTrees.forEach(collection => {
        children.push(TocTreeItem.fromCollection(collection))
      })
      return children
    }

    return element.children
  }
}

export class TocTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly children: TocTreeItem[],
    public readonly description?: string
  ) {
    super(label, collapsibleState)
  }

  static fromCollection(treeCollection: TocTreeCollection): TocTreeItem {
    const collapsibleState = vscode.TreeItemCollapsibleState.Collapsed
    const children: TocTreeItem[] = []

    treeCollection.children.forEach(element => {
      if (element.type === TocTreeElementType.module) {
        children.push(TocTreeItem.fromModule(element))
      } else {
        children.push(TocTreeItem.fromCollection(element))
      }
    })

    return new TocTreeItem(treeCollection.title, collapsibleState, children)
  }

  static fromModule(treeModule: TocTreeModule): TocTreeItem {
    return new TocTreeItem(
      treeModule.title,
      vscode.TreeItemCollapsibleState.None,
      [],
      treeModule.moduleid
    )
  }
}
