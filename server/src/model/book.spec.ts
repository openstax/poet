import { expect } from '@jest/globals'
import { BookValidationKind } from './book'
import { bookMaker, BookMakerTocNode, expectErrors, first, loadSuccess, makeBundle, pageMaker } from './spec-helpers.spec'

describe('Book validations', () => {
  it(BookValidationKind.DUPLICATE_CHAPTER_TITLE.title, () => {
    const bundle = makeBundle()
    const book = first(loadSuccess(bundle).books)
    const chapterTitle = 'Kinematics'
    const toc: BookMakerTocNode[] = [
      { title: chapterTitle, children: [] },
      { title: chapterTitle, children: [] }
    ]
    book.load(bookMaker({ toc }))
    expectErrors(book, [BookValidationKind.DUPLICATE_CHAPTER_TITLE, BookValidationKind.DUPLICATE_CHAPTER_TITLE])
  })
  it(BookValidationKind.MISSING_PAGE.title, () => {
    const bundle = makeBundle()
    const book = loadSuccess(first(loadSuccess(bundle).books))
    const page = first(book.pages)
    page.load(undefined)
    expectErrors(book, [BookValidationKind.MISSING_PAGE])
  })
  it(BookValidationKind.DUPLICATE_PAGE.title, () => {
    const bundle = makeBundle()
    const book = first(loadSuccess(bundle).books)
    const toc: BookMakerTocNode[] = [
      { title: 'Chapter 1', children: ['m00001'] },
      { title: 'Chapter 2', children: ['m00001'] }
    ]
    book.load(bookMaker({ toc }))
    const page = first(book.pages)
    page.load(pageMaker({}))
    expectErrors(book, [BookValidationKind.DUPLICATE_PAGE, BookValidationKind.DUPLICATE_PAGE])
  })
})

describe('Book computed properties', () => {
  it('Returns license', () => {
    const bundle = makeBundle()
    const book = first(loadSuccess(bundle).books)
    book.load(bookMaker({ licenseUrl: 'http://creativecommons.org/licenses/by-nd/4.0' }))
    expect(book.license).toEqual({
      text: 'Creative Commons Attribution-NoDerivatives License',
      type: 'Creative Commons Attribution-NoDerivatives',
      url: 'http://creativecommons.org/licenses/by-nd/4.0/',
      version: '4.0'
    })
  })
})
