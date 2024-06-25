import { expect } from '@jest/globals'
import * as Quarx from 'quarx'
import { type TocNode, TocNodeKind } from './utils'
import { bookMaker, first, loadSuccess, makeBundle, pageMaker } from './spec-helpers.spec'
import { type PageNode } from './page'

describe('Quarx.autorun code', () => {
  it('Triggers a ToC autorun when the Page title changes', () => {
    const bundle = loadSuccess(makeBundle())
    const book = loadSuccess(first(bundle.books))
    const page = loadSuccess(first(book.pages))
    page.load(pageMaker({ title: 'test' }))

    let autorunCalls = 0
    let tocSideEffect = ''

    Quarx.autorun(() => {
      // Do something that requests the page titles so this autorun will run when the titles change
      tocSideEffect = book.toc.map(tocToString).join(' ')
      autorunCalls++
    })
    expect(autorunCalls).toBe(1)
    // Change the page title
    page.load(pageMaker({ title: 'test2' }))
    expect(autorunCalls).toBe(2)
    // Title remains the same
    page.load(pageMaker({ title: 'test2' }))
    expect(autorunCalls).toBe(2)

    // just so that the tocSideEffect does not get marked as an unused variable by the linter
    expect(tocSideEffect.length).toBeGreaterThan(0)
  })
  it('Triggers a ToC autorun when the ToC disappears', () => {
    const bundle = loadSuccess(makeBundle())
    const book = loadSuccess(first(bundle.books))
    book.pages.forEach(p => loadSuccess(p))

    let autorunCalls = 0
    let tocSideEffect = ''

    Quarx.autorun(() => {
      // Do something that requests the page titles so this autorun will run when the titles change
      tocSideEffect = book.toc.map(tocToString).join(' ')
      autorunCalls++
    })
    expect(autorunCalls).toBe(1)
    book.load(bookMaker({ toc: [{ title: 'intro', children: [] }] }))
    expect(autorunCalls).toBe(2)

    // just so that the tocSideEffect does not get marked as an unused variable by the linter
    expect(tocSideEffect.length).toBeGreaterThanOrEqual(0)
  })
})

function tocToString(n: TocNode<PageNode>): string {
  if (n.type === TocNodeKind.Subbook) {
    return n.children.map(tocToString).join(' ')
  } else {
    return n.page.title
  }
}
