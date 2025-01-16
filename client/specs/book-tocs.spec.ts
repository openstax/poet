import SinonRoot from 'sinon'
import type vscode from 'vscode'
import { expect } from '@jest/globals'

import { BookRootNode, type BookToc, type ClientTocNode, TocNodeKind } from '../../common/src/toc'
import { type BookOrTocNode, type OrphanCollection, OrphanCollectionKind, TocsTreeProvider, toggleTocTreesFilteringHandler } from '../src/book-tocs'

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
const testOrphanCollection: OrphanCollection = {
  type: OrphanCollectionKind,
  children: []
}
describe('Toc Provider', () => {
  const p = new TocsTreeProvider()
  it('returns tree items for children', () => {
    expect(p.getTreeItem(testToc)).toMatchSnapshot()
    expect(p.getTreeItem(testTocSubbook)).toMatchSnapshot()
    expect(p.getTreeItem(testTocPage)).toMatchSnapshot()
    expect(p.getTreeItem(testTocAncillary)).toMatchSnapshot()
    expect(p.getTreeItem(testOrphanCollection)).toMatchSnapshot()
  })
  it('filters fileids when filtering is set', () => {
    const p = new TocsTreeProvider()
    p.update([testToc], [])
    expect(p.getTreeItem(testTocPage)).toMatchSnapshot()
    p.toggleFilterMode()
    expect(p.getTreeItem(testTocPage)).toMatchSnapshot()
    p.toggleFilterMode()
    expect(p.getTreeItem(testTocPage)).toMatchSnapshot()
  })
  it('says loading when a page does not have a title yet', () => {
    expect(p.getTreeItem(testTocPage).label).toBe(testTocPage.value.title)
    const nonloadedPage = { ...testTocPage, value: { ...testTocPage.value, title: undefined } }
    expect(p.getTreeItem(nonloadedPage).label).toBe('Loading...')
    p.toggleFilterMode()
    expect(p.getTreeItem(nonloadedPage).label).toBe(`Loading... (${nonloadedPage.value.fileId})`)
  })
  it('gets children and parents', () => {
    p.update([testToc], [])
    expect(p.getChildren()).toEqual([testToc, { children: [], type: OrphanCollectionKind, value: undefined }])
    expect(p.getParent(testToc)).toBe(undefined)
    expect(p.getChildren(testToc)).toEqual(testToc.tocTree)
    expect(p.getParent(testToc.tocTree[0])).toBe(testToc)
    expect(p.getParentBook(testToc)).toBe(undefined)
  })
})

describe('filtering', () => {
  const sinon = SinonRoot.createSandbox()
  afterEach(() => { sinon.restore() })
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
      { type: BookRootNode.Singleton, tocTree: [{ type: TocNodeKind.Subbook, label: 'unit1', children: [{ type: TocNodeKind.Subbook, label: 'subcol1', children: [{ type: TocNodeKind.Page, label: 'm2', children: [] }] }] }] },
      { type: BookRootNode.Singleton, tocTree: [{ label: 'm1', children: [] }] },
      { type: OrphanCollectionKind, children: [], value: undefined }
    ]
    getChildrenStub.returns(fakeChildren)

    const handler = toggleTocTreesFilteringHandler(view, provider)
    await handler()
    expect(toggleFilterStub.callCount).toBe(1)
    expect(getChildrenStub.callCount).toBe(1)
    expect(revealStub.callCount).toBe(3)
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
