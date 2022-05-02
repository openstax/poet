import expect from 'expect'

import { BookRootNode, BookToc, ClientTocNode, TocNodeKind } from '../src/common/toc'
import { TocsTreeProvider } from '../src/book-tocs'

const testTocPage: ClientTocNode = {
  type: TocNodeKind.Page,
  value: {
    absPath: '/path/to/file',
    token: 'token',
    title: 'title',
    fileId: 'fileId'
  }
}
const testTocSubbook: ClientTocNode = {
  type: TocNodeKind.Subbook,
  value: { token: 'token', title: 'title' },
  children: [testTocPage]
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

describe('Toc Provider', () => {
  const p = new TocsTreeProvider()
  it('returns tree items for children', () => {
    expect(p.getTreeItem(testToc)).toMatchSnapshot()
    expect(p.getTreeItem(testTocSubbook)).toMatchSnapshot()
    expect(p.getTreeItem(testTocPage)).toMatchSnapshot()
  })
  it('filters fileids when filtering is set', () => {
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
    p.update([testToc])
    expect(p.getChildren()).toEqual([testToc])
    expect(p.getParent(testToc)).toBe(undefined)
    expect(p.getChildren(testToc)).toEqual(testToc.tocTree)
    expect(p.getParent(testToc.tocTree[0])).toBe(testToc)
  })
})
