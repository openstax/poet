import { EventEmitter, type TreeItem, TreeItemCollapsibleState, Uri, type TreeDataProvider } from 'vscode'

import { type BookToc, type ClientTocNode, BookRootNode, TocNodeKind, type ClientPageish } from '../../common/src/toc'
import { TocItemIcon } from './toc-trees-provider'

export type BookOrTocNode = BookToc | ClientTocNode

const toClientTocNode = (n: ClientPageish): ClientTocNode => ({ type: TocNodeKind.Page, value: n })

export class TocsTreeProvider implements TreeDataProvider<BookOrTocNode> {
  private readonly _onDidChangeTreeData = new EventEmitter<void>()
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event

  public includeFileIdsForFilter = false
  private bookTocs: BookToc[]
  private orphans: BookOrTocNode[]
  private readonly parentsMap = new Map<BookOrTocNode, BookOrTocNode>()

  constructor() {
    this.bookTocs = []
    this.orphans = []
  }

  public toggleFilterMode() {
    this.includeFileIdsForFilter = !this.includeFileIdsForFilter
    this._onDidChangeTreeData.fire()
  }

  public update(n: BookToc[], o: ClientPageish[]) {
    this.bookTocs = n
    this.parentsMap.clear()
    this.bookTocs.forEach(n => { this.recAddParent(n) })
    this.orphans = o.map(toClientTocNode)
    this._onDidChangeTreeData.fire()
  }

  private recAddParent(node: BookOrTocNode) {
    const kids = this.getChildren(node)
    kids.forEach(k => {
      this.parentsMap.set(k, node)
      this.recAddParent(k)
    })
  }

  public getTreeItem(node: BookOrTocNode): TreeItem {
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
    } else if (node.type === TocNodeKind.Page) {
      const uri = Uri.parse(node.value.absPath)
      const title = node.value.title ?? 'Loading...'
      const ret = this.includeFileIdsForFilter ? { label: `${title} (${node.value.fileId})` } : { label: title, description: node.value.fileId }
      return {
        ...ret,
        iconPath: TocItemIcon.Page,
        collapsibleState: TreeItemCollapsibleState.None,
        resourceUri: uri,
        command: { title: 'open', command: 'vscode.open', arguments: [uri] },
        contextValue: TocNodeKind.Page
      }
    } else {
      return {
        iconPath: TocItemIcon.Subbook,
        collapsibleState: TreeItemCollapsibleState.Collapsed,
        label: node.value.title,
        contextValue: TocNodeKind.Subbook
      }
    }
  }

  public getChildren(node?: BookOrTocNode) {
    let kids: BookOrTocNode[] = []
    if (node === undefined) {
      return [...this.bookTocs, ...this.orphans]
    } else if (node.type === BookRootNode.Singleton) {
      kids = node.tocTree
    } else if (node.type === TocNodeKind.Page) {
      kids = []
    } else {
      kids = node.children
    }
    return kids
  }

  public getParent(node: BookOrTocNode) {
    return this.parentsMap.get(node)
  }

  public getParentBook(node: BookOrTocNode): BookToc | undefined {
    let bookNode: BookOrTocNode | undefined = node
    // Books do not have parent books
    if (bookNode.type === BookRootNode.Singleton) return undefined
    while (bookNode !== undefined && bookNode.type !== BookRootNode.Singleton) {
      bookNode = this.getParent(bookNode)
    }
    return bookNode?.type === BookRootNode.Singleton ? bookNode : undefined
  }

  public getParentBookIndex(node: BookOrTocNode) {
    const parentBook = this.getParentBook(node)
    let idx: number | undefined
    if (parentBook !== undefined) {
      idx = this.bookTocs.findIndex((b) => b.absPath === parentBook.absPath)
    }
    return idx === -1 ? undefined : idx
  }
}
