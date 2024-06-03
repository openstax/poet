import vscode from 'vscode'
import { type TocsTreeProvider, type BookOrTocNode } from './book-tocs'
import { type TocModification, TocModificationKind, type TocModificationParams, TocNodeKind, BookRootNode } from '../../common/src/toc'
import { ExtensionServerRequest } from '../../common/src/requests'
import { expect, getRootPathUri } from './utils'
import { type ExtensionHostContext } from './panel'

const getNodeToken = (node: BookOrTocNode) => {
  return node.type === TocNodeKind.Page || node.type === TocNodeKind.Subbook
    ? node.value.token
    : undefined
}

export const XFER_ITEM_ID = 'application/vnd.code.tree.tocTrees'

export class TocsEventHandler implements vscode.TreeDragAndDropController<BookOrTocNode> {
  constructor(
    private readonly tocTreesProvider: TocsTreeProvider,
    private readonly context: ExtensionHostContext
  ) {}

  dragMimeTypes: readonly string[] = ['application/xml']
  dropMimeTypes: readonly string[] = this.dragMimeTypes

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
      newParentToken = getNodeToken(newParent)
      // Do not try to move a book/subbook into itself
      if (newParentToken === nodeToken) { return }
      newChildIndex = this.tocTreesProvider
        .getChildren(newParent)
        .findIndex((node) => getNodeToken(node) === targetToken)
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
      'BUG: Could not get token of node'
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
    dataTransfer.set(XFER_ITEM_ID, new vscode.DataTransferItem(source[0]))
  }

  async handleDrop(target: BookOrTocNode | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
    const dragging: BookOrTocNode | undefined = dataTransfer.get(XFER_ITEM_ID)?.value
    if (dragging?.type === undefined) throw new Error('BUG: Bad drag target')
    if (target === undefined) throw new Error('BUG: Bad drop target')
    if (target !== dragging && dragging.type !== BookRootNode.Singleton) {
      if (target.type === BookRootNode.Singleton) {
        await this.removeNode(dragging)
      } else {
        await this.moveNode(dragging, target)
      }
    }
  }
}
