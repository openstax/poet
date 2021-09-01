import { BookValidationKind } from './book'
import { expectErrors, first, loadSuccess, makeBundle } from './util.spec'
import { pageMaker } from './page.spec'

describe('Book validations', () => {
  it(BookValidationKind.DUPLICATE_CHAPTER_TITLE, () => {
    const bundle = makeBundle()
    const book = first(loadSuccess(bundle).books)
    const chapterTitle = 'Kinematics'
    const toc: TocNode[] = [
      { title: chapterTitle, children: [] },
      { title: chapterTitle, children: [] }
    ]
    book.load(bookMaker(toc))
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
    book.load(bookMaker(toc))
    const page = first(book.pages)
    page.load(pageMaker({}))
    expectErrors(book, [BookValidationKind.DUPLICATE_PAGE])
  })
})

type TocNode = {
  title: string
  children: TocNode[]
} | string
export function bookMaker(toc: TocNode[]) {
  const title = 'test collection'
  const slug = 'slug1'
  const uuid = '00000000-0000-4000-0000-000000000000'
  return `<col:collection xmlns:col="http://cnx.rice.edu/collxml" xmlns:md="http://cnx.rice.edu/mdml" xmlns="http://cnx.rice.edu/collxml">
    <col:metadata>
      <md:title>${title}</md:title>
      <md:slug>${slug}</md:slug>
      <md:uuid>${uuid}</md:uuid>
    </col:metadata>
    <col:content>
        ${toc.map(tocToString).join('\n')}
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
