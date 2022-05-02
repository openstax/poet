import vscode, { ThemeIcon } from 'vscode'
import { BookRootNode, ClientTocNode, TocNodeKind } from './common/toc'
import { TocsTreeProvider, BookOrTocNode } from './book-tocs'
import { ExtensionHostContext } from './panel'

export const TocItemIcon = {
  Page: ThemeIcon.File,
  Book: new ThemeIcon('book'),
  Subbook: ThemeIcon.Folder
}

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
        element.iconPath,
        `${element.label} (${element.description})`,
        element.collapsibleState,
        element.children,
        element.command,
        undefined
      )
    }
    return element
  }

  getChildren(element?: TocTreeItem): TocTreeItem[] {
    return element?.children ?? []
  }

  getParent(element: TocTreeItem): vscode.ProviderResult<TocTreeItem> {
    return element.parent
  }
}

export class TocTreeItem extends vscode.TreeItem {
  parent: TocTreeItem | undefined = undefined

  constructor(
    public readonly iconPath: ThemeIcon,
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly children: TocTreeItem[],
    public readonly command?: vscode.Command,
    public readonly description?: string
  ) {
    super(label, collapsibleState)
    this.children.forEach(child => { child.parent = this })
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
