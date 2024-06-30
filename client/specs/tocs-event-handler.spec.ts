import { jest, expect } from '@jest/globals'
import { type BookOrTocNode, TocsTreeProvider } from '../src/book-tocs'
import { type ClientTocNode, TocNodeKind, type BookToc, BookRootNode, TocModificationKind, type TocModification, type CreateSubbookEvent, type CreatePageEvent, type CreateAncillaryEvent } from '../../common/src/toc'
import { TocsEventHandler, XFER_ITEM_ID } from '../src/tocs-event-handler'
import { type LanguageClient } from 'vscode-languageclient/node'
import { type ExtensionHostContext } from '../src/panel'
import { ExtensionServerRequest } from '../../common/src/requests'
import { DataTransferItem, type DataTransfer } from 'vscode'

import vscode from 'vscode'

const createPage = (title: string, token: string, fileId: string, absPath: string): ClientTocNode => ({
  type: TocNodeKind.Page,
  value: { title, token, fileId, absPath }
})

const createBookToC = () => {
  const testTocPage: ClientTocNode = {
    type: TocNodeKind.Page,
    value: {
      absPath: '/path/to/file',
      token: 'token',
      title: 'title',
      fileId: 'fileId'
    }
  }
  const testTocAncillary: ClientTocNode = {
    type: TocNodeKind.Ancillary,
    value: {
      absPath: '/path/to/ancillary',
      token: 'token',
      title: 'title',
      fileId: 'fileId'
    }
  }
  const testTocSubbook: ClientTocNode = {
    type: TocNodeKind.Subbook,
    value: { token: 'token', title: 'title' },
    children: [testTocPage, testTocAncillary]
  }
  const testToc: BookToc = {
    type: BookRootNode.Singleton,
    absPath: '/some/path',
    uuid: 'uuid',
    title: 'title',
    slug: 'slug',
    language: 'language',
    licenseUrl: 'licenseUrl',
    tocTree: [testTocSubbook]
  }
  return testToc
}

const testToc = Object.freeze(createBookToC())
const testTocSubbook = testToc.tocTree[0] as (ClientTocNode & { type: TocNodeKind.Subbook })
const testTocPage = testTocSubbook.children[0]
const testTocAncillary = testTocSubbook.children[1]
const orphanedPage = createPage(
  'orphan', 'Token', 'file2', '/path/to/file2'
)

const stub = <T extends object>(obj: T, overrides: Record<string | symbol, any>) =>
  new Proxy(
    obj,
    {
      get: (target, p) => Reflect.get(overrides, p) ?? Reflect.get(target, p)
    }
  )

describe('TocsEventHandler', () => {
  let mockClient: LanguageClient
  let mockHostContext: ExtensionHostContext
  let tocsTreeProvider: TocsTreeProvider
  let tocsEventHandler: TocsEventHandler
  let askTitleMock: jest.Mock<any>
  const tocsEventHandlerOverrides = {
    workspaceUri: ''
  }
  let sendRequestMock: jest.Mock
  beforeEach(() => {
    sendRequestMock = jest.fn()
    askTitleMock = jest.fn().mockReturnValue('new-title')
    mockClient = {
      sendRequest: sendRequestMock
    } as unknown as LanguageClient
    mockHostContext = {
      client: mockClient
    } as unknown as ExtensionHostContext
    tocsTreeProvider = new TocsTreeProvider()
    tocsEventHandler = stub(
      new TocsEventHandler(tocsTreeProvider, mockHostContext), tocsEventHandlerOverrides
    )
    tocsEventHandler.askTitle = askTitleMock
    tocsTreeProvider.update([testToc], [])
  })
  describe('remove node', () => {
    it('sends the correct event', async () => {
      expect(sendRequestMock).not.toHaveBeenCalled()
      await tocsEventHandler.removeNode(testTocPage)
      expect(sendRequestMock).toHaveBeenCalledTimes(1)
      expect(sendRequestMock).toBeCalledWith(
        ExtensionServerRequest.TocModification,
        {
          workspaceUri: tocsEventHandlerOverrides.workspaceUri,
          event: {
            type: TocModificationKind.Remove,
            nodeToken: testTocPage.value.token,
            bookIndex: 0
          }
        }
      )
    })
    it('ignores orphaned nodes', async () => {
      expect(sendRequestMock).not.toHaveBeenCalled()
      await tocsEventHandler.removeNode(orphanedPage)
      expect(sendRequestMock).not.toHaveBeenCalled()
    })
    it('rejects invalid nodes', async () => {
      expect(sendRequestMock).not.toHaveBeenCalled()
      await expect(tocsEventHandler.removeNode({} as unknown as BookOrTocNode)).rejects.toThrow(/token/)
      expect(sendRequestMock).not.toHaveBeenCalled()
    })
  })
  describe('move node', () => {
    const testCases: Array<{
      subtitle: string
      node: BookOrTocNode
      target: BookOrTocNode
      event: TocModification
    }> = [
      {
        subtitle: 'drag page onto page in subbook',
        node: orphanedPage,
        target: testTocPage,
        event: {
          type: TocModificationKind.Move,
          bookIndex: 0,
          newChildIndex: 0,
          newParentToken: testTocSubbook.value.token,
          nodeToken: orphanedPage.value.token
        }
      },
      {
        subtitle: 'drag page onto subbook',
        node: testTocPage,
        target: testTocSubbook,
        event: {
          type: TocModificationKind.Move,
          bookIndex: 0,
          newChildIndex: 0,
          newParentToken: undefined, // = testToc.token,
          nodeToken: testTocPage.value.token
        }
      },
      {
        subtitle: 'drag orphaned page onto subbook',
        node: orphanedPage,
        target: testTocSubbook,
        event: {
          type: TocModificationKind.Move,
          bookIndex: 0,
          newChildIndex: 0,
          newParentToken: undefined, // = testToc.token,
          nodeToken: orphanedPage.value.token
        }
      }
    ]
    testCases.forEach(({ subtitle, node, target, event }) => {
      it(`sends the correct event (${subtitle})`, async () => {
        expect(sendRequestMock).not.toHaveBeenCalled()
        await tocsEventHandler.moveNode(node, target)
        expect(sendRequestMock).toHaveBeenCalledTimes(1)
        expect(sendRequestMock).toBeCalledWith(
          ExtensionServerRequest.TocModification,
          {
            workspaceUri: tocsEventHandlerOverrides.workspaceUri,
            event
          }
        )
      })
    })
    it('uses the index of the target', async () => {
      const newPage = createPage('my-page', 'my-token', 'my-file', '/your/abspath')
      const toc = createBookToC()
      const subbook = toc.tocTree[0] as (ClientTocNode & { type: TocNodeKind.Subbook })
      subbook.children.push(newPage)
      tocsTreeProvider.update([toc], [])
      expect(sendRequestMock).not.toHaveBeenCalled()
      await tocsEventHandler.moveNode(orphanedPage, newPage)
      expect(sendRequestMock).toHaveBeenCalledTimes(1)
      expect(sendRequestMock).toBeCalledWith(
        ExtensionServerRequest.TocModification,
        {
          workspaceUri: tocsEventHandlerOverrides.workspaceUri,
          event: {
            type: TocModificationKind.Move,
            bookIndex: 0,
            newChildIndex: 2,
            newParentToken: subbook.value.token,
            nodeToken: orphanedPage.value.token
          }
        }
      )
    })
    it('throws when node token is undefined', async () => {
      await expect(tocsEventHandler.moveNode({} as unknown as BookOrTocNode, {} as unknown as BookOrTocNode)).rejects.toThrow(/token.*dragged.*node/)
    })
    it('does not try to move a subbook into itself', async () => {
      // Since the dragged node is moved to the same level as the drop target
      // and testTocPage is a child of testTocSubbook, this could create a
      // situation where LS is asked to move a subbook into itself. This is
      // undefined behavior and should never happen. tl;dr: 1/0
      await tocsEventHandler.moveNode(testTocSubbook, testTocPage)
      expect(sendRequestMock).not.toHaveBeenCalled()
    })
  })

  describe('add node', () => {
    const testCases: Array<{
      subtitle: string
      node: BookOrTocNode
      event: CreatePageEvent | CreateSubbookEvent | CreateAncillaryEvent
    }> = [
      {
        subtitle: 'page',
        node: testTocPage,
        event: {
          type: TocNodeKind.Page,
          title: 'new-title',
          bookIndex: 0
        }
      },
      {
        subtitle: 'subbook',
        node: testTocSubbook,
        event: {
          type: TocNodeKind.Subbook,
          title: 'new-title',
          slug: 'new-slug',
          bookIndex: 0
        }
      },
      {
        subtitle: 'ancillary',
        node: testTocAncillary,
        event: {
          type: TocNodeKind.Ancillary,
          title: 'new-title',
          bookIndex: 0
        }
      }
    ]
    testCases.forEach(({ subtitle, node, event }) => {
      it(`sends the correct event (${subtitle})`, async () => {
        expect(sendRequestMock).toHaveBeenCalledTimes(0)
        await tocsEventHandler.addNode(event.type, node, 'new-slug')
        expect(askTitleMock).toHaveBeenCalledTimes(1)
        expect(sendRequestMock).toHaveBeenCalledTimes(1)
        expect(sendRequestMock).toHaveBeenCalledWith(
          ExtensionServerRequest.TocModification,
          {
            workspaceUri: tocsEventHandlerOverrides.workspaceUri,
            event
          }
        )
      })
    })
  })

  describe('rename node', () => {
    const testCases: Array<{
      subtitle: string
      node: BookOrTocNode
      title: string
      event: TocModification
    }> = [
      {
        subtitle: 'rename page',
        node: testTocPage,
        title: 'title',
        event: {
          type: TocModificationKind.PageRename,
          nodeToken: testTocPage.value.token,
          newTitle: 'new-title',
          bookIndex: 0
        }
      },
      {
        subtitle: 'subbook',
        node: testTocSubbook,
        title: 'title',
        event: {
          type: TocModificationKind.SubbookRename,
          nodeToken: testTocSubbook.value.token,
          newTitle: 'new-title',
          bookIndex: 0
        }
      },
      {
        subtitle: 'ancillary',
        node: testTocAncillary,
        title: 'title',
        event: {
          type: TocModificationKind.AncillaryRename,
          nodeToken: testTocAncillary.value.token,
          newTitle: 'new-title',
          bookIndex: 0
        }
      }
    ]
    testCases.forEach(({ subtitle, node, title, event }) => {
      it(`sends the correct event (${subtitle})`, async () => {
        expect(sendRequestMock).toHaveBeenCalledTimes(0)
        await tocsEventHandler.renameNode(node)
        expect(askTitleMock).toHaveBeenCalledTimes(1)
        expect(askTitleMock).toHaveBeenCalledWith('')
        expect(sendRequestMock).toHaveBeenCalledTimes(1)
        expect(sendRequestMock).toHaveBeenCalledWith(
          ExtensionServerRequest.TocModification,
          {
            workspaceUri: tocsEventHandlerOverrides.workspaceUri,
            event
          }
        )
      })
    })
  })

  describe('askTitle', () => {
    let withSubbedEvents: TocsEventHandler
    beforeEach(() => {
      withSubbedEvents = stub(
        new TocsEventHandler(tocsTreeProvider, mockHostContext),
        tocsEventHandlerOverrides
      )
    })
    it('should prompt the user for a title and validate the input', async () => {
      let result = await withSubbedEvents.askTitle('title')
      expect(result).toBeUndefined()
      expect(vscode.window.showInputBox).toBeCalledTimes(1)

      result = await withSubbedEvents.askTitle('default-title')
      expect(result).toBeUndefined()
      expect(vscode.window.showInputBox).toBeCalledTimes(2)
      expect(vscode.window.showInputBox).toHaveBeenCalledWith({
        prompt: 'Please enter the title',
        value: 'default-title',
        validateInput: expect.any(Function)
      })
    })
  })

  describe('workspaceUri', () => {
    it('errors when value is null', async () => {
      const t = new TocsEventHandler(tocsTreeProvider, mockHostContext)
      // Expected to fail in test setting
      expect(() => Reflect.get(t, 'workspaceUri')).toThrow()
    })
  })
  describe('handleDrag', () => {
    it('sets the data transfer item', () => {
      const dt = { set: jest.fn() }
      tocsEventHandler.handleDrag([orphanedPage], dt as any)
      expect(dt.set).toHaveBeenCalledWith(
        XFER_ITEM_ID,
        new DataTransferItem(orphanedPage)
      )
    })
  })
  describe('handleDrop', () => {
    let removeNodeStub: jest.Mock
    let moveNodeStub: jest.Mock
    let withSubbedEvents: TocsEventHandler
    beforeEach(() => {
      removeNodeStub = jest.fn()
      moveNodeStub = jest.fn()
      withSubbedEvents = stub(
        new TocsEventHandler(tocsTreeProvider, mockHostContext),
        {
          ...tocsEventHandlerOverrides,
          removeNode: removeNodeStub,
          moveNode: moveNodeStub
        })
    })
    it('throws if it drag target is invalid', async () => {
      const dt = { get: () => undefined } as unknown as DataTransfer
      await expect(withSubbedEvents.handleDrop(testTocPage, dt)).rejects.toThrow(/drag/)
      expect(removeNodeStub).not.toHaveBeenCalled()
      expect(moveNodeStub).not.toHaveBeenCalled()
    })
    it('throws if the drop target is invalid', async () => {
      const dt = { get: () => ({ value: orphanedPage }) } as unknown as DataTransfer
      await expect(withSubbedEvents.handleDrop(undefined, dt)).rejects.toThrow(/drop/)
      expect(removeNodeStub).not.toHaveBeenCalled()
      expect(moveNodeStub).not.toHaveBeenCalled()
    })
    it('calls removeNode when the target is a book', async () => {
      const dt = { get: () => ({ value: orphanedPage }) } as unknown as DataTransfer
      await withSubbedEvents.handleDrop(testToc, dt)
      expect(removeNodeStub).toHaveBeenCalledWith(orphanedPage)
      expect(moveNodeStub).not.toHaveBeenCalled()
    })
    it('calls moveNode when the target is anything else', async () => {
      const dt = { get: () => ({ value: orphanedPage }) } as unknown as DataTransfer
      await withSubbedEvents.handleDrop(testTocPage, dt)
      expect(removeNodeStub).not.toHaveBeenCalled()
      expect(moveNodeStub).toHaveBeenCalledWith(orphanedPage, testTocPage)
    })
  })
})
