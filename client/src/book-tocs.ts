import { EventEmitter, TreeItemCollapsibleState, Uri, TreeDataProvider } from 'vscode'

import { BookToc, ClientTocNode, BookRootNode, TocNodeKind } from '../../common/src/toc-tree'
import { TocItemIcon } from './toc-trees'

export type BookOrTocNode = BookToc | ClientTocNode

export class TocsTreeProvider implements TreeDataProvider<BookOrTocNode> {
  private readonly _onDidChangeTreeData = new EventEmitter<void>()
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event

  public includeFileIdsForFilter = false
  private bookTocs: BookToc[]
  private readonly parentsMap = new Map<BookOrTocNode, BookOrTocNode>()

  constructor() {
    this.bookTocs = []
  }

  public toggleFilterMode() {
    this.includeFileIdsForFilter = !this.includeFileIdsForFilter
    this._onDidChangeTreeData.fire()
  }

  public update(n: BookToc[]) {
    this.bookTocs = n
    this.parentsMap.clear()
    this.bookTocs.forEach(n => this.recAddParent(n))
    this._onDidChangeTreeData.fire()
  }

  private recAddParent(node: BookOrTocNode) {
    const kids = this.getChildren(node)
    kids.forEach(k => {
      this.parentsMap.set(k, node)
      this.recAddParent(k)
    })
  }

  public getTreeItem(node: BookOrTocNode) {
    if (node.type === BookRootNode.Singleton) {
      const uri = Uri.parse(node.absPath)
      return {
        iconPath: TocItemIcon.Book,
        collapsibleState: TreeItemCollapsibleState.Collapsed,
        label: node.title,
        description: node.slug,
        resourceUri: uri,
        command: { title: 'open', command: 'vscode.open', arguments: [uri] }
      }
    } else if (node.type === TocNodeKind.Leaf) {
      const uri = Uri.parse(node.value.absPath)
      const ret = this.includeFileIdsForFilter ? { label: `${node.value.title ?? 'Loading...'} (${node.value.fileId})` } : { label: node.value.title, description: node.value.fileId }
      return {
        ...ret,
        iconPath: TocItemIcon.Page,
        collapsibleState: TreeItemCollapsibleState.None,
        resourceUri: uri,
        command: { title: 'open', command: 'vscode.open', arguments: [uri] }
      }
    } else {
      return {
        iconPath: TocItemIcon.SubBook,
        collapsibleState: TreeItemCollapsibleState.Collapsed,
        label: node.value.title
      }
    }
  }

  public getChildren(node?: BookOrTocNode) {
    let kids: BookOrTocNode[] = []
    if (node === undefined) {
      return this.bookTocs
    } else if (node.type === BookRootNode.Singleton) {
      kids = node.tree
    } else if (node.type === TocNodeKind.Leaf) {
      kids = []
    } else {
      kids = node.children
    }
    return kids
  }

  public getParent(node: BookOrTocNode) {
    return this.parentsMap.get(node)
  }
}
