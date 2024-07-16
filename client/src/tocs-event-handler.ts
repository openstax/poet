import vscode from 'vscode'
import { type TocsTreeProvider, type BookOrTocNode } from './book-tocs'
import { type TocModification, TocModificationKind, type TocModificationParams, TocNodeKind, BookRootNode, type CreatePageEvent, type CreateSubbookEvent, type CreateAncillaryEvent } from '../../common/src/toc'
import { ExtensionServerRequest } from '../../common/src/requests'
import { expect, getRootPathUri } from './utils'
import { type ExtensionHostContext } from './panel'

const getNodeToken = (node: BookOrTocNode) => {
  return node.type === TocNodeKind.Page || node.type === TocNodeKind.Subbook || node.type === TocNodeKind.Ancillary
    ? node.value.token
    : undefined
}

export const validateTitle = (title: string) => {
  return title.trim().length === 0 ? 'Title cannot be empty' : undefined
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

  private async fireEvent(event: TocModification | CreateSubbookEvent | CreatePageEvent | CreateAncillaryEvent) {
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

  async askTitle(title?: string): Promise<string | undefined> {
    return await vscode.window.showInputBox({
      prompt: 'Please enter the title',
      /* istanbul ignore next */
      value: title,
      validateInput: validateTitle
    })
  }

  async addNode(nodeType: TocNodeKind, node: BookOrTocNode, slug: string | undefined) {
    const title = await this.askTitle()
    /* istanbul ignore next */
    if (title === undefined) { return }
    let bookIndex = this.tocTreesProvider.getParentBookIndex(node)
    if (bookIndex === undefined) { bookIndex = 0 }
    if (nodeType === TocNodeKind.Page) {
      const event: CreatePageEvent = {
        type: TocNodeKind.Page,
        title,
        bookIndex
      }
      await this.fireEvent(event)
    } else if (nodeType === TocNodeKind.Subbook) {
      const event: CreateSubbookEvent = {
        type: TocNodeKind.Subbook,
        title,
        slug,
        bookIndex
      }
      await this.fireEvent(event)
    } else if (nodeType === TocNodeKind.Ancillary) {
      const event: CreateAncillaryEvent = {
        type: TocNodeKind.Ancillary,
        title,
        bookIndex
      }
      await this.fireEvent(event)
    }
  }

  async renameNode(node: BookOrTocNode) {
    // TODO Implement the rename functionality using inline editing (wait for the API to be available)
    // https://github.com/microsoft/vscode/issues/97190
    // https://stackoverflow.com/questions/70594061/change-an-existing-label-name-in-tree-view-vscode-extension
    let oldTitle: string | undefined = ''
    if (node.type !== BookRootNode.Singleton && 'title' in node.value) {
      /* istanbul ignore next */
      oldTitle = node.value.title
    }
    const newTitle = await this.askTitle(oldTitle)
    const nodeToken = expect(
      getNodeToken(node),
      'BUG: Could not get token of renamed node'
    )
    /* istanbul ignore next */
    if (newTitle === undefined) { return }
    const bookIndex = expect(this.tocTreesProvider.getParentBookIndex(node), 'BUG: Could not get index of parent book')
    if (node.type === TocNodeKind.Subbook) {
      const event: TocModification = {
        type: TocModificationKind.SubbookRename,
        newTitle,
        nodeToken,
        bookIndex
      }
      await this.fireEvent(event)
    } else if (node.type === TocNodeKind.Page) {
      const event: TocModification = {
        type: TocModificationKind.PageRename,
        newTitle,
        nodeToken,
        bookIndex
      }
      await this.fireEvent(event)
    } else if (node.type === TocNodeKind.Ancillary) {
      const event: TocModification = {
        type: TocModificationKind.AncillaryRename,
        newTitle,
        nodeToken,
        bookIndex
      }
      await this.fireEvent(event)
    }
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
