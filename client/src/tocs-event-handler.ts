import type vscode from 'vscode'
import { type TocsTreeProvider, type BookOrTocNode } from './book-tocs'
import { type CreatePageEvent, type CreateSubbookEvent, type TocModification, TocModificationKind, type TocModificationParams, TocNodeKind } from '../../common/src/toc'
import { ExtensionServerRequest, type Opt } from '../../common/src/requests'
import { expect, getRootPathUri } from './utils'
import { type ExtensionHostContext } from './panel'

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
    console.log(arguments)
    this.dragging = source[0]
  }

  async handleDrop(target: BookOrTocNode | undefined): Promise<void> {
    console.log(arguments)
    let event: Opt<TocModification | CreatePageEvent | CreateSubbookEvent>
    const dragging = this.dragging
    const getNodeToken = (node: BookOrTocNode | undefined) => {
      if (node?.type === TocNodeKind.Page) return node.value.token
      if (node?.type === TocNodeKind.Subbook) return node.value.token
      return undefined
    }

    if (dragging !== undefined && dragging !== target) {
      let newParentToken: string | undefined
      let newChildIndex = 0
      const bookIndex = 0
      const nodeToken = expect(getNodeToken(dragging), '')
      if (target !== undefined) {
        const newParent = this.tocTreesProvider.getParent(target)
        const targetToken = expect(getNodeToken(target), '')
        newParentToken = getNodeToken(newParent)
        if (newParent !== undefined) {
          newChildIndex = this.tocTreesProvider
            .getChildren(newParent)
            .findIndex((node) => getNodeToken(node) === targetToken)
          if (newChildIndex === -1) newChildIndex = 0
        }
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
  }
}
