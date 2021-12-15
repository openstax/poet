import { BookValidationKind } from './book'
import { expectErrors, first, loadSuccess, makeBundle } from './util.spec'
import { pageMaker } from './page.spec'
import { PageNode, PageValidationKind } from './page'

describe('Book validations', () => {
  it(BookValidationKind.DUPLICATE_CHAPTER_TITLE, () => {
    const bundle = makeBundle()
    const book = first(loadSuccess(bundle).books)
    const chapterTitle = 'Kinematics'
    const toc: TocNode[] = [
      { title: chapterTitle, children: [] },
      { title: chapterTitle, children: [] }
    ]
    book.load(bookMaker({ toc }))
    expectErrors(book, [BookValidationKind.DUPLICATE_CHAPTER_TITLE])
  })
  it(BookValidationKind.MISSING_PAGE, () => {
    const bundle = makeBundle()
    const book = loadSuccess(first(loadSuccess(bundle).books))
    const page = first(book.pages)
    page.load(undefined)
    expectErrors(book, [BookValidationKind.MISSING_PAGE])
  })
  it(BookValidationKind.DUPLICATE_PAGE, () => {
    const bundle = makeBundle()
    const book = first(loadSuccess(bundle).books)
    const toc: TocNode[] = [
      { title: 'Chapter 1', children: ['m00001'] },
      { title: 'Chapter 2', children: ['m00001'] }
    ]
    book.load(bookMaker({ toc }))
    const page = first(book.pages)
    page.load(pageMaker({}))
    expectErrors(book, [BookValidationKind.DUPLICATE_PAGE])
  })
  describe('Introductions', () => {
    let page = null as unknown as PageNode
    beforeEach(() => {
      const bundle = makeBundle()
      const book = first(loadSuccess(bundle).books)
      const chapterTitle = 'Kinematics'
      const toc: TocNode[] = [
        { title: chapterTitle, children: ['m00001'] }
      ]
      book.load(bookMaker({ toc }))
      page = first(book.pages)
    })
    it('Does not error when the first Page in a Chapter has class="introduction"', () => {
      page.load(pageMaker({ pageClass: 'introduction' }))
      expectErrors(page, [])
    })
    it('Errors when the first Page in a Chapter does not have the class="introduction"', () => {
      page.load(pageMaker({ pageClass: 'something-other-than-intro' }))
      expectErrors(page, [PageValidationKind.MISSING_INTRO])
    })
    it('Errors when the Page loses class="introduction"', () => {
      page.load(pageMaker({ pageClass: 'introduction' }))
      expectErrors(page, [])
      page.load(pageMaker({ pageClass: 'something-other-than-intro' }))
      expectErrors(page, [PageValidationKind.MISSING_INTRO])
    })
    it('Does not error when the first Page in a Chapter gains the class="introduction"', () => {
      page.load(pageMaker({ pageClass: 'something-other-than-intro' }))
      expectErrors(page, [PageValidationKind.MISSING_INTRO])
      page.load(pageMaker({ pageClass: 'introduction' }))
      expectErrors(page, [])
    })
  })
})

type TocNode = {
  title: string
  children: TocNode[]
} | string
interface BookMakerInfo {
  title?: string
  slug?: string
  uuid?: string
  language?: string
  licenseUrl?: string
  toc?: TocNode[]
}
export function bookMaker(info: BookMakerInfo) {
  const i = {
    title: info.title ?? 'test collection',
    slug: info.slug ?? 'slug1',
    langauge: info.language ?? 'xxyyzz',
    licenseUrl: info.licenseUrl ?? 'http://creativecommons.org/licenses/by/4.0/',
    uuid: info.uuid ?? '00000000-0000-4000-0000-000000000000',
    toc: info.toc ?? []
  }
  return `<col:collection xmlns:col="http://cnx.rice.edu/collxml" xmlns:md="http://cnx.rice.edu/mdml" xmlns="http://cnx.rice.edu/collxml">
    <col:metadata>
      <md:title>${i.title}</md:title>
      <md:slug>${i.slug}</md:slug>
      <md:uuid>${i.uuid}</md:uuid>
      <md:language>${i.langauge}</md:language>
      <md:license url="${i.licenseUrl}"/>
    </col:metadata>
    <col:content>
        ${i.toc.map(tocToString).join('\n')}
    </col:content>
</col:collection>`
}
function tocToString(node: TocNode): string {
  if (typeof node === 'string') {
    return `<col:module document="${node}" />`
  } else {
    return `<col:subcollection>
        <md:title>${node.title}</md:title>
        <col:content>
            ${node.children.map(tocToString).join('\n')}
        </col:content>
    </col:subcollection>`
  }
}
