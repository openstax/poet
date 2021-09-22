import { join } from 'path'
import expect from 'expect'
import SinonRoot, { SinonStub } from 'sinon'

import vscode, { Disposable, Event, EventEmitter, Uri, ViewColumn, WebviewPanel } from 'vscode'
import { BookRootNode, BookToc, TocNodeKind, TocModificationKind, TocMoveEvent, TocRemoveEvent, PageRenameEvent, SubbookRenameEvent } from '../../common/src/toc-tree'
import * as utils from '../src/utils' // Used for dependency mocking in tests
import { TocItemIcon, TocTreeItem, TocTreesProvider, toggleTocTreesFilteringHandler } from '../src/toc-trees'
import { PanelIncomingMessage, TocEditorPanel } from '../src/panel-toc-editor'
import { LanguageClient } from 'vscode-languageclient/node'
import { DEFAULT_BOOK_TOCS_ARGS, ExtensionServerRequest } from '../../common/src/requests'
import { ExtensionEvents, ExtensionHostContext } from '../src/panel'
import { BookOrTocNode, TocsTreeProvider } from '../src/book-tocs'

const TEST_OUT_DIR = join(__dirname, '../src')
const resourceRootDir = TEST_OUT_DIR

const createMockClient = () => {
  const sendRequestStub = SinonRoot.stub()
  sendRequestStub.returns([])
  const client = {
    sendRequest: sendRequestStub,
    onRequest: SinonRoot.stub().returns({ dispose: () => { } })
  } as unknown as LanguageClient

  return {
    client,
    sendRequestStub
  }
}

type ExtractEventGeneric<GenericEvent> = GenericEvent extends Event<infer X> ? X : never
type ExtensionEventEmitters = { [key in keyof ExtensionEvents]: EventEmitter<ExtractEventGeneric<ExtensionEvents[key]>> }
const createMockEvents = (): { emitters: ExtensionEventEmitters, events: ExtensionEvents } => {
  const onDidChangeWatchedFilesEmitter: EventEmitter<undefined> = new EventEmitter()
  const emitters = {
    onDidChangeWatchedFiles: onDidChangeWatchedFilesEmitter
  }
  const events = {
    onDidChangeWatchedFiles: onDidChangeWatchedFilesEmitter.event
  }
  return { emitters, events }
}

describe('Toc Editor', () => {
  const sinon = SinonRoot.createSandbox()
  afterEach(() => sinon.restore())
  it('TocTreesProvider returns expected TocTreeItems', async () => {
    const fakeTreeCollection: BookToc[] = []
    fakeTreeCollection.push(
      {
        type: BookRootNode.Singleton,
        title: 'Collection1',
        slug: 'collection1',
        uuid: '',
        language: '',
        licenseUrl: '',
        absPath: 'path/to/nowhere-book',
        tree: [{
          type: TocNodeKind.Inner,
          value: { token: 'id123', title: 'subcollection' },
          children: [{
            type: TocNodeKind.Leaf,
            value: {
              token: 'id234',
              absPath: 'path/to/nowhere',
              fileId: 'm00001',
              title: 'Module1'
            }
          },
          {
            type: TocNodeKind.Leaf,
            value: {
              token: 'id345',
              absPath: 'path/to/nowhere2',
              fileId: 'm00002',
              title: 'Module2'
            }
          }]
        }]
      },
      {
        type: BookRootNode.Singleton,
        title: 'Collection2',
        slug: 'collection2',
        uuid: '',
        language: '',
        licenseUrl: '',
        absPath: 'path/to/nowhere-book',
        tree: [{
          type: TocNodeKind.Leaf,
          value: {
            token: 'id123',
            absPath: 'path/to/nowhere3',
            fileId: 'm00003',
            title: 'Module3'
          }
        }]
      }
    )
    const fakeWorkspacePath = '/tmp/fakeworkspace'
    sinon.stub(utils, 'getRootPathUri').returns(vscode.Uri.file(fakeWorkspacePath))
    const module1Item = new TocTreeItem(
      TocItemIcon.Page,
      'Module1',
      vscode.TreeItemCollapsibleState.None,
      [],
      {
        title: 'open',
        command: 'vscode.open',
        arguments: [vscode.Uri.file(`${fakeWorkspacePath}/modules/m00001/index.cnxml`)]
      },
      'm00001'
    )
    const module2Item = new TocTreeItem(
      TocItemIcon.Page,
      'Module2',
      vscode.TreeItemCollapsibleState.None,
      [],
      {
        title: 'open',
        command: 'vscode.open',
        arguments: [vscode.Uri.file(`${fakeWorkspacePath}/modules/m00002/index.cnxml`)]
      },
      'm00002'
    )
    const module3Item = new TocTreeItem(
      TocItemIcon.Page,
      'Module3',
      vscode.TreeItemCollapsibleState.None,
      [],
      {
        title: 'open',
        command: 'vscode.open',
        arguments: [vscode.Uri.file(`${fakeWorkspacePath}/modules/m00003/index.cnxml`)]
      },
      'm00003'
    )
    const subcollectionItem = new TocTreeItem(
      TocItemIcon.SubBook,
      'subcollection',
      vscode.TreeItemCollapsibleState.Collapsed,
      [module1Item, module2Item]
    )
    const collection1Item = new TocTreeItem(
      TocItemIcon.Book,
      'Collection1',
      vscode.TreeItemCollapsibleState.Collapsed,
      [subcollectionItem],
      {
        title: 'open',
        command: 'vscode.open',
        arguments: [vscode.Uri.file(`${fakeWorkspacePath}/collections/collection1.collection.xml`)]
      }
    )
    const collection2Item = new TocTreeItem(
      TocItemIcon.Book,
      'Collection2',
      vscode.TreeItemCollapsibleState.Collapsed,
      [module3Item],
      {
        title: 'open',
        command: 'vscode.open',
        arguments: [vscode.Uri.file(`${fakeWorkspacePath}/collections/collection2.collection.xml`)]
      }
    )

    const mockClient = createMockClient().client
    // We don't want to just return []
    const sendRequestMock = sinon.stub()
    mockClient.sendRequest = sendRequestMock
    const tocTreesProvider = new TocTreesProvider({ bookTocs: DEFAULT_BOOK_TOCS_ARGS, resourceRootDir, client: mockClient, events: createMockEvents().events })
    sendRequestMock.onCall(0).resolves(null)
    sendRequestMock.onCall(1).resolves(fakeTreeCollection)

    expect(await tocTreesProvider.getChildren(undefined)).toMatchSnapshot()
    expect(await tocTreesProvider.getChildren(undefined)).toMatchSnapshot()
    expect(collection1Item).toMatchSnapshot()
    expect(await tocTreesProvider.getChildren(collection2Item)).toMatchSnapshot()
    expect(tocTreesProvider.getTreeItem(collection2Item)).toMatchSnapshot()
    expect(await tocTreesProvider.getParent(collection2Item)).toMatchSnapshot()
    expect(await tocTreesProvider.getParent(module3Item)).toMatchSnapshot()
    expect(await tocTreesProvider.getParent(module1Item)).toMatchSnapshot()
    tocTreesProvider.toggleFilterMode()
    expect(tocTreesProvider.getTreeItem(module3Item)).toMatchSnapshot()
  })

  describe('PanelTocEditor', () => {
    let postMessageStub = undefined as unknown as SinonStub<[message: any], Thenable<boolean>>
    let onDidReceiveMessageStub: SinonRoot.SinonStub<[listener: (e: any) => any, thisArgs?: any, disposables?: vscode.Disposable[] | undefined], vscode.Disposable>
    let p = undefined as unknown as TocEditorPanel
    const { client, sendRequestStub } = createMockClient()
    const { emitters, events } = createMockEvents()
    const context: ExtensionHostContext = {
      resourceRootDir: join(__dirname, '..', 'static'), // HTML webview files are loaded from here
      client,
      events,
      bookTocs: { version: 1, books: [], orphans: [] }
    }
    beforeEach(() => {
      const webviewPanel = vscode.window.createWebviewPanel('unused', 'unused', ViewColumn.Active)
      postMessageStub = sinon.stub(webviewPanel.webview, 'postMessage')
      onDidReceiveMessageStub = sinon.stub(webviewPanel.webview, 'onDidReceiveMessage')
      onDidReceiveMessageStub.returns(new Disposable(sinon.stub()))
      sinon.stub(vscode.window, 'createWebviewPanel').returns(webviewPanel)

      p = new TocEditorPanel(context)
    })
    it('calls handleMessage when the Webview sends a message', () => {
      const handleMessageStub = sinon.stub(p, 'handleMessage')
      const message: PanelIncomingMessage = {
        type: 'TOC_REMOVE',
        event: {
          type: TocModificationKind.Remove,
          nodeToken: 'my-token-id',
          bookIndex: 0
        }
      }
      expect(handleMessageStub.callCount).toBe(0)
      expect(onDidReceiveMessageStub.callCount).toBe(1)
      onDidReceiveMessageStub.firstCall.args[0](message)
      expect(handleMessageStub.callCount).toBe(1)
    })
    it('translates events from the webview and sends them to the language server', async () => {
      let callCount = 0
      function getMessage(reqType: ExtensionServerRequest = ExtensionServerRequest.TocModification) {
        if (sendRequestStub.callCount <= callCount) { throw new Error('expected sendRequest to have been called but it was not') }
        const c = sendRequestStub.getCall(callCount++)
        if (c.firstArg !== reqType) { throw new Error(`expected the first arg of sendRequest to be '${reqType}' but it was '${c.firstArg as unknown as string}'`) }
        return c.args[1]
      }
      const uberEvent = {
        newTitle: 'my_new_title',
        nodeToken: 'mytoken',
        newParentToken: undefined,
        newChildIndex: 0,
        bookIndex: 0
      }

      sinon.stub(vscode.workspace, 'workspaceFolders').get(() => [{ uri: Uri.file('/path/to/workspace/root') }])
      await p.handleMessage({ type: 'TOC_MOVE', event: uberEvent as unknown as TocMoveEvent })
      expect(getMessage().event.type).toBe(TocModificationKind.Move)
      await p.handleMessage({ type: 'TOC_REMOVE', event: uberEvent as unknown as TocRemoveEvent })
      expect(getMessage().event.type).toBe(TocModificationKind.Remove)
      await p.handleMessage({ type: 'PAGE_RENAME', event: uberEvent as unknown as PageRenameEvent })
      expect(getMessage().event.type).toBe(TocModificationKind.PageRename)
      await p.handleMessage({ type: 'SUBBOOK_RENAME', event: uberEvent as unknown as SubbookRenameEvent })
      expect(getMessage().event.type).toBe(TocModificationKind.SubbookRename)

      sinon.stub(vscode.window, 'showInputBox').returns(Promise.resolve('new_title'))
      await p.handleMessage({ type: 'PAGE_CREATE', bookIndex: 0 })
      expect(getMessage(ExtensionServerRequest.NewPage).title).toBe('new_title')

      await p.handleMessage({ type: 'SUBBOOK_CREATE', bookIndex: 0, slug: 'subbook_slug' })
      expect(getMessage(ExtensionServerRequest.NewSubbook).title).toBe('new_title')
    })
    it('disposes', () => {
      expect(() => p.dispose()).not.toThrow()
    })
    it('sends a message to Webview when a fileChanged event is emitted', () => {
      expect(postMessageStub.callCount).toBe(0)
      emitters.onDidChangeWatchedFiles.fire()
      expect(postMessageStub.callCount).toBe(1)
    })
    it('sends a message to Webview when the content is updated', async () => {
      const testToc: BookToc = {
        type: BookRootNode.Singleton,
        absPath: '/fake/path',
        uuid: 'uuid',
        title: 'title',
        slug: 'slug',
        language: 'language',
        licenseUrl: 'licenseUrl',
        tree: [{
          type: TocNodeKind.Inner,
          value: {
            token: 'token',
            title: 'title'
          },
          children: [{
            type: TocNodeKind.Leaf,
            value: {
              token: 'token',
              title: 'title',
              fileId: 'fileId',
              absPath: '/fake/path/to/file'
            }
          }]
        }]
      }
      const v1 = { version: 1, books: [testToc], orphans: [] }

      expect(postMessageStub.callCount).toBe(0)
      await p.update(v1)
      expect(postMessageStub.callCount).toBe(1)
      expect(postMessageStub.firstCall.args).toMatchSnapshot()
    })
    it('does not send a message to Webview when panel is disposed', async () => {
      await expect(p.refreshPanel({} as unknown as WebviewPanel, client)).rejects
    })
  })

  describe('filtering', () => {
    it('toggleTocTreesFilteringHandler', async () => {
      const revealStub = sinon.stub()
      const toggleFilterStub = sinon.stub()
      const getChildrenStub = sinon.stub()
      const refreshStub = sinon.stub()

      const view: vscode.TreeView<BookOrTocNode> = {
        reveal: revealStub
      } as unknown as vscode.TreeView<BookOrTocNode>
      const provider: TocsTreeProvider = {
        toggleFilterMode: toggleFilterStub,
        getChildren: getChildrenStub,
        refresh: refreshStub,
        getParent: () => undefined
      } as unknown as TocsTreeProvider
      const fakeChildren = [
        { type: BookRootNode.Singleton, label: 'col1', tree: [{ type: TocNodeKind.Inner, label: 'unit1', children: [{ type: TocNodeKind.Inner, label: 'subcol1', children: [{ type: TocNodeKind.Leaf, label: 'm2', children: [] }] }] }] },
        { type: BookRootNode.Singleton, label: 'col2', tree: [{ label: 'm1', children: [] }] }
      ]
      getChildrenStub.returns(fakeChildren)

      const handler = toggleTocTreesFilteringHandler(view, provider)
      await handler()
      expect(toggleFilterStub.callCount).toBe(1)
      expect(getChildrenStub.callCount).toBe(1)
      expect(revealStub.callCount).toBe(2)
      expect(revealStub.getCalls().map(c => c.args)).toMatchSnapshot()
      expect(refreshStub.callCount).toBe(0)
    })
    it('toggleTocTreesFilteringHandler disables itself while revealing', async () => {
      const revealStub = sinon.stub()
      const toggleFilterStub = sinon.stub()
      const getChildrenStub = sinon.stub()
      const fakeChildren = [
        { label: 'col1', children: [{ label: 'm1', children: [] }] }
      ]
      getChildrenStub.returns(fakeChildren)

      const view: vscode.TreeView<BookOrTocNode> = {
        reveal: revealStub
      } as unknown as vscode.TreeView<BookOrTocNode>
      const provider: TocsTreeProvider = {
        toggleFilterMode: toggleFilterStub,
        getChildren: getChildrenStub,
        getParent: () => undefined
      } as unknown as TocsTreeProvider

      const handler = toggleTocTreesFilteringHandler(view, provider)
      // Invoke the handler the first time reveal is called to simulate a parallel
      // user request without resorting to synthetic delay injection
      revealStub.onCall(0).callsFake(handler)
      await handler()
      expect(toggleFilterStub.callCount).toBe(1)
      expect(revealStub.callCount).toBe(1)
      expect(getChildrenStub.callCount).toBe(1)
    })
    it('toggleTocTreesFilteringHandler does not lock itself on errors', async () => {
      const toggleFilterStub = sinon.stub().throws()
      const view: vscode.TreeView<BookOrTocNode> = {} as unknown as vscode.TreeView<BookOrTocNode>
      const provider: TocsTreeProvider = {
        toggleFilterMode: toggleFilterStub
      } as unknown as TocsTreeProvider

      const handler = toggleTocTreesFilteringHandler(view, provider)
      try { await handler() } catch { }
      try { await handler() } catch { }
      expect(toggleFilterStub.callCount).toBe(2)
    })
  })
})
