import expect from 'expect'
import * as Quarx from 'quarx'
import { TocNode, TocNodeKind } from './utils'
import { bookMaker, first, loadSuccess, makeBundle, read } from './spec-helpers'
import { PageNode } from './page'

describe('Quarx.autorun code', () => {
  it('Triggers a ToC autorun when the Page title changes', () => {
    const bugTosser = () => { throw new Error('BUG: Title should already have been loaded') }
    const bundle = loadSuccess(makeBundle())
    const book = loadSuccess(first(bundle.books))
    const page = loadSuccess(first(book.pages))
    const origTitle = page.title(bugTosser)
    const xml = read(page.absPath)
    const xml2 = xml.replace(origTitle, `${origTitle}2`)
    const xml3 = xml2 + ' '

    let autorunCalls = 0
    let tocSideEffect = ''

    Quarx.autorun(() => {
      // Do something that requests the page titles so this autorun will run when the titles change
      tocSideEffect = book.toc.map(tocToString).join(' ')
      autorunCalls++
    })
    expect(autorunCalls).toBe(1)
    // Change the page title
    page.load(xml2)
    expect(autorunCalls).toBe(2)
    // Changing page whitespace
    page.load(xml3)
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
    return n.page.title(() => { throw new Error('BUG: Title should have been loaded by now') })
  }
}
