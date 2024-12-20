import { EventEmitter, type TreeItem, TreeItemCollapsibleState, Uri, type TreeDataProvider, ThemeIcon } from 'vscode'

import { type BookToc, type ClientTocNode, BookRootNode, TocNodeKind, type ClientPageish } from '../../common/src/toc'
import type vscode from 'vscode'

export type BookOrTocNode = BookToc | ClientTocNode

const toClientTocNode = (n: ClientPageish): ClientTocNode => ({ type: TocNodeKind.Page, value: n })

export const TocItemIcon = {
  Page: ThemeIcon.File,
  Book: new ThemeIcon('book'),
  Subbook: ThemeIcon.Folder
}

export class TocsTreeProvider implements TreeDataProvider<BookOrTocNode> {
  private readonly _onDidChangeTreeData = new EventEmitter<void>()
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event

  public includeFileIdsForFilter = false
  private bookTocs: BookToc[]
  private orphans: ClientTocNode[]
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
    const capabilities: string[] = [
      'rename'
    ]
    if (this.getParent(node) !== undefined) {
      capabilities.push('delete')
    }
    switch (node.type) {
      case BookRootNode.Singleton: {
        const uri = Uri.parse(node.absPath)
        return {
          iconPath: TocItemIcon.Book,
          collapsibleState: TreeItemCollapsibleState.Collapsed,
          label: node.title,
          description: node.slug,
          resourceUri: uri,
          command: { title: 'open', command: 'vscode.open', arguments: [uri] }
        }
      }
      case TocNodeKind.Ancillary:
      case TocNodeKind.Page: {
        const uri = Uri.parse(node.value.absPath)
        const title = node.value.title ?? 'Loading...'
        const ret = this.includeFileIdsForFilter ? { label: `${title} (${node.value.fileId})` } : { label: title, description: node.value.fileId }
        return {
          ...ret,
          iconPath: TocItemIcon.Page,
          collapsibleState: TreeItemCollapsibleState.None,
          resourceUri: uri,
          command: { title: 'open', command: 'vscode.open', arguments: [uri] },
          contextValue: capabilities.join(',')
        }
      }
      case TocNodeKind.Subbook:
        return {
          iconPath: TocItemIcon.Subbook,
          collapsibleState: TreeItemCollapsibleState.Collapsed,
          label: node.value.title,
          contextValue: capabilities.join(',')
        }
    }
  }

  public getChildren(node?: BookOrTocNode) {
    let kids: BookOrTocNode[] = []
    if (node === undefined) {
      kids = [...this.bookTocs, ...this.orphans]
    } else if (node.type === BookRootNode.Singleton) {
      kids = node.tocTree
    } else if (node.type === TocNodeKind.Page || node.type === TocNodeKind.Ancillary) {
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
    const recursiveFindParent = (n: BookOrTocNode | undefined): BookToc | undefined => {
      if (n === undefined) return undefined
      if (n.type === BookRootNode.Singleton) return n
      return recursiveFindParent(this.getParent(n))
    }
    // If the original node is a book, it has no parent
    return node.type === BookRootNode.Singleton
      ? undefined
      : recursiveFindParent(node)
  }

  public getBookIndex(node: BookToc) {
    return this.bookTocs.findIndex((b) => b.absPath === node.absPath)
  }

  public getParentBookIndex(node: BookOrTocNode) {
    const parentBook = this.getParentBook(node)
    return parentBook === undefined
      ? undefined
      : this.getBookIndex(parentBook)
  }
}

export function toggleTocTreesFilteringHandler(view: vscode.TreeView<BookOrTocNode>, provider: TocsTreeProvider): () => Promise<void> {
  let revealing: boolean = false

  // We call the view.reveal API for all nodes with children to ensure the tree
  // is fully expanded. This approach is used since attempting to simply call
  // reveal on root notes with the max expand value of 3 doesn't seem to always
  // fully expose leaf nodes for large trees.
  function leafFinder(acc: ClientTocNode[], elements: BookOrTocNode[]) {
    for (const el of elements) {
      if (el.type === BookRootNode.Singleton) {
        leafFinder(acc, el.tocTree)
      } else if (el.type === TocNodeKind.Subbook) {
        leafFinder(acc, el.children)
      } else {
        acc.push(el)
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
      const leaves: ClientTocNode[] = []
      leafFinder(leaves, provider.getChildren())
      const nodes3Up = new Set<BookOrTocNode>() // VSCode allows expanding up to 3 levels down
      leaves.forEach(l => {
        const p1 = provider.getParent(l)
        const p2 = p1 === undefined ? undefined : /* istanbul ignore next */ provider.getParent(p1)
        const p3 = p2 === undefined ? undefined : /* istanbul ignore next */ provider.getParent(p2)
        /* istanbul ignore next */
        nodes3Up.add(p3 ?? p2 ?? p1 ?? l)
      })
      for (const node of Array.from(nodes3Up).reverse()) {
        await view.reveal(node, { expand: 3 })
      }
    } finally {
      revealing = false
    }
  }
}
