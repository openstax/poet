import expect from 'expect'

import { BookRootNode, BookToc, ClientTocNode, TocNodeKind } from '../../common/src/toc-tree'
import { TocsTreeProvider } from '../src/book-tocs'

describe('Toc Provider', () => {
  const p = new TocsTreeProvider()
  const nPage: ClientTocNode = {
    type: TocNodeKind.Leaf,
    value: {
      absPath: '/path/to/file',
      token: 'token',
      title: 'title',
      fileId: 'fileId'
    }
  }
  const nSubbook: ClientTocNode = {
    type: TocNodeKind.Inner,
    value: { token: 'token', title: 'title' },
    children: [nPage]
  }
  const toc: BookToc = {
    type: BookRootNode.Singleton,
    absPath: '/some/path',
    uuid: 'uuid',
    title: 'title',
    slug: 'slug',
    language: 'language',
    licenseUrl: 'licenseUrl',
    tree: [nSubbook]
  }
  it('returns tree items for children', () => {
    expect(p.getTreeItem(toc)).toMatchSnapshot()
    expect(p.getTreeItem(nSubbook)).toMatchSnapshot()
    expect(p.getTreeItem(nPage)).toMatchSnapshot()
  })
  it('filters fileids when filtering is set', () => {
    expect(p.getTreeItem(nPage)).toMatchSnapshot()
    p.toggleFilterMode()
    expect(p.getTreeItem(nPage)).toMatchSnapshot()
    p.toggleFilterMode()
    expect(p.getTreeItem(nPage)).toMatchSnapshot()
  })
  it('says loading when a page does not have a title yet', () => {
    expect(p.getTreeItem(nPage).label).toBe(nPage.value.title)
    const nonloadedPage = { ...nPage, value: { ...nPage.value, title: undefined } }
    expect(p.getTreeItem(nonloadedPage).label).toBe('Loading...')
    p.toggleFilterMode()
    expect(p.getTreeItem(nonloadedPage).label).toBe(`Loading... (${nonloadedPage.value.fileId})`)
  })
  it('gets children and parents', () => {
    p.update([toc])
    expect(p.getChildren()).toEqual([toc])
    expect(p.getParent(toc)).toBe(undefined)
    expect(p.getChildren(toc)).toEqual(toc.tree)
    expect(p.getParent(toc.tree[0])).toBe(toc)
  })
})
