import type vscode from 'vscode'
import { type TocsTreeProvider, type BookOrTocNode } from './book-tocs'
import { type CreatePageEvent, type CreateSubbookEvent, type TocModification, TocModificationKind, type TocModificationParams, TocNodeKind, BookRootNode } from '../../common/src/toc'
import { ExtensionServerRequest, type Opt } from '../../common/src/requests'
import { expect, getRootPathUri } from './utils'
import { type ExtensionHostContext } from './panel'

const getNodeToken = (node: BookOrTocNode | undefined) => {
  if (node?.type === TocNodeKind.Page) return node.value.token
  if (node?.type === TocNodeKind.Subbook) return node.value.token
  return undefined
}

export class TocsEventHandler implements vscode.TreeDragAndDropController<BookOrTocNode> {
  private dragging: BookOrTocNode | undefined = undefined

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

  handleDrag(source: readonly BookOrTocNode[]): void | Thenable<void> {
    this.dragging = source[0]
  }

  async handleDrop(target: BookOrTocNode | undefined): Promise<void> {
    try {
      let event: Opt<TocModification | CreatePageEvent | CreateSubbookEvent>
      const dragging = this.dragging
      if (target === undefined || dragging === undefined || target === dragging) {
        return
      }

      const nodeToken = expect(
        getNodeToken(dragging),
        'BUG: Could not get token of dragged node'
      )
      if (target.type === BookRootNode.Singleton) {
        const bookIndex = expect(
          this.tocTreesProvider.getParentBookIndex(dragging),
          'BUG: Could not get index of parent book'
        )
        event = {
          type: TocModificationKind.Remove,
          nodeToken,
          bookIndex
        }
      } else {
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
        event = {
          type: TocModificationKind.Move,
          nodeToken,
          newParentToken,
          newChildIndex,
          bookIndex
        }
      }
      if (event !== undefined) {
        const workspaceUri = this.workspaceUri
        const params: TocModificationParams = { workspaceUri, event }
        await this.context.client.sendRequest(
          ExtensionServerRequest.TocModification,
          params
        )
      }
    } finally {
      this.dragging = undefined
    }
  }
}
