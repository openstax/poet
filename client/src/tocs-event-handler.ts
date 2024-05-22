import vscode from 'vscode'
import { type TocsTreeProvider, type BookOrTocNode } from './book-tocs'
import { type TocModification, TocModificationKind, type TocModificationParams, TocNodeKind, BookRootNode } from '../../common/src/toc'
import { ExtensionServerRequest } from '../../common/src/requests'
import { expect, getRootPathUri } from './utils'
import { type ExtensionHostContext } from './panel'

const getNodeToken = (node: BookOrTocNode | undefined) => {
  if (node?.type === TocNodeKind.Page) return node.value.token
  if (node?.type === TocNodeKind.Subbook) return node.value.token
  return undefined
}

export class TocsEventHandler implements vscode.TreeDragAndDropController<BookOrTocNode> {
  private readonly treeId = 'application/vnd.code.tree.tocTrees'

  constructor(
    private readonly tocTreesProvider: TocsTreeProvider,
    private readonly context: ExtensionHostContext
  ) {}

  get dragMimeTypes() {
    return ['application/xml']
  }

  get dropMimeTypes() {
    return this.dragMimeTypes
  }

  private get workspaceUri() {
    return expect(getRootPathUri(), 'Could not get root path uri').toString()
  }

  private async fireEvent(event: TocModification) {
    const workspaceUri = this.workspaceUri
    const params: TocModificationParams = { workspaceUri, event }
    await this.context.client.sendRequest(
      ExtensionServerRequest.TocModification,
      params
    )
  }

  async moveNode(node: BookOrTocNode, target: BookOrTocNode) {
    const nodeToken = expect(
      getNodeToken(node),
      'BUG: Could not get token of dragged node'
    )
    let newParentToken: string | undefined
    let newChildIndex = 0
    const bookIndex = expect(
      this.tocTreesProvider.getParentBookIndex(target),
      'BUG: Could not get index of target\'s parent book'
    )
    const newParent = this.tocTreesProvider.getParent(target)
    if (newParent !== undefined) {
      const targetToken = expect(
        getNodeToken(target),
        'BUG: Could not get target token'
      )
      newChildIndex = this.tocTreesProvider
        .getChildren(newParent)
        .findIndex((node) => getNodeToken(node) === targetToken)
      if (newChildIndex === -1) newChildIndex = 0
      newParentToken = getNodeToken(newParent)
    }
    const event: TocModification = {
      type: TocModificationKind.Move,
      nodeToken,
      newParentToken,
      newChildIndex,
      bookIndex
    }
    await this.fireEvent(event)
  }

  async removeNode(node: BookOrTocNode) {
    const nodeToken = expect(
      getNodeToken(node),
      'BUG: Could not get token of dragged node'
    )
    const bookIndex = this.tocTreesProvider.getParentBookIndex(node)
    if (bookIndex === undefined) { return }
    const event: TocModification = {
      type: TocModificationKind.Remove,
      nodeToken,
      bookIndex
    }
    await this.fireEvent(event)
  }

  handleDrag(source: readonly BookOrTocNode[], dataTransfer: vscode.DataTransfer): void {
    dataTransfer.set(this.treeId, new vscode.DataTransferItem(source[0]))
  }

  async handleDrop(target: BookOrTocNode | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
    const dragging: BookOrTocNode | undefined = dataTransfer.get(this.treeId)?.value
    if (dragging?.type === undefined) throw new Error('BUG: Bad drag target')
    if (target?.type === undefined) throw new Error('BUG: Bad drop target')
    if (target === dragging || dragging.type === BookRootNode.Singleton) {
      return
    }
    if (target.type === BookRootNode.Singleton) {
      await this.removeNode(dragging)
    } else {
      await this.moveNode(dragging, target)
    }
  }
}
