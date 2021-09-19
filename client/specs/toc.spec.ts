import { join } from 'path'
import expect from 'expect'
import SinonRoot from 'sinon'

import vscode, { Event, EventEmitter } from 'vscode'
import { BookRootNode, BookToc, TocNodeKind } from '../../common/src/toc-tree'
import * as utils from '../src/utils' // Used for dependency mocking in tests
import { TocItemIcon, TocTreeItem, TocTreesProvider } from '../src/toc-trees'
import { LanguageClient } from 'vscode-languageclient/node'
import { DEFAULT_BOOK_TOCS_ARGS } from '../../common/src/requests'
import { ExtensionEvents } from '../src/panel'

// function assertDeepStrictEqual<T>(actual: any, expected: T): asserts actual is T {
//   expect(actual).toEqual(expected)
// }

const TEST_OUT_DIR = join(__dirname, '../src')
const resourceRootDir = TEST_OUT_DIR

const createMockClient = (): LanguageClient => {
  return {
    sendRequest: SinonRoot.stub().returns([]),
    onRequest: SinonRoot.stub().returns({ dispose: () => { } })
  } as unknown as LanguageClient
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

    const mockClient = createMockClient()
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
})
