import { expect } from '@jest/globals'
import I from 'immutable'
import { BookNode } from './model/book'
import { bookMaker, bundleMaker, makeBundle } from './model/spec-helpers.spec'
import { generateReadmeForWorkspace } from './readme-generator'

describe('generate readme', () => {
  const slugs = [
    'stuff-things',
    'stuff-other-things',
    'other-stuff-other-things'
  ]

  const titles = [
    'Stuff and things',
    'Stuff and other things',
    'Other stuff and other things'
  ]

  const initBooks = (books: I.Set<BookNode>) => {
    books.toArray().forEach((book, idx) => {
      book.load(bookMaker({ slug: slugs[idx], title: titles[idx] }))
    })
  }

  it('generates the readme for a single book', () => {
    const bundle = makeBundle()
    bundle.load(bundleMaker({ books: [slugs[0]] }))
    initBooks(bundle.books)
    const output = generateReadmeForWorkspace(Array.from(bundle.allBooks.all))
    const outputLines = output.split('\n')
    expect(outputLines.length).toBe(14)
    expect(outputLines[0].startsWith(`# ${titles[0]}`)).toBe(true)
    expect(outputLines[4].startsWith(`_${titles[0]}_`)).toBe(true)
    expect(outputLines[6]).toContain(`The book can be viewed [online](https://openstax.org/details/books/${slugs[0]})`)
  })

  it('generates the readme for a bundle of two', () => {
    const bundle = makeBundle()
    bundle.load(bundleMaker({ books: slugs.slice(0, 2) }))
    initBooks(bundle.books)
    const output = generateReadmeForWorkspace(Array.from(bundle.allBooks.all))
    const outputLines = output.split('\n')
    expect(outputLines.length).toBe(16)
    expect(outputLines[0].startsWith(`# ${titles[0] + ' and ' + titles[1]}`)).toBe(true)
    expect(outputLines[4].startsWith(`_${titles[0] + ' and ' + titles[1]}_`)).toBe(true)
    slugs
      .slice(0, 2)
      .map((slug, idx) => [slug, titles[idx]])
      .forEach(([slug, title], idx: number) => {
        expect(outputLines[7 + idx]).toContain(`- _${title}_ [online](https://openstax.org/details/books/${slug})`)
      })
  })

  it('generates the readme for a bundle of three', () => {
    const bundle = makeBundle()
    bundle.load(bundleMaker({ books: slugs }))
    initBooks(bundle.books)
    const output = generateReadmeForWorkspace(Array.from(bundle.allBooks.all))
    const outputLines = output.split('\n')
    expect(outputLines.length).toBe(17)
    expect(outputLines[0].startsWith(`# ${titles[0]}, ${titles[1]}, and ${titles[2]}`)).toBe(true)
    expect(outputLines[4].startsWith(`_${titles[0]}, ${titles[1]}, and ${titles[2]}_`)).toBe(true)
    slugs
      .map((slug, idx) => [slug, titles[idx]])
      .forEach(([slug, title], idx: number) => {
        expect(outputLines[7 + idx]).toContain(`- _${title}_ [online](https://openstax.org/details/books/${slug})`)
      })
  })

  it('fails for bundles that contain various licenses', () => {
    const bundle = makeBundle()
    bundle.load(bundleMaker({ books: [slugs[0], slugs[1]] }))
    bundle.books.toArray().forEach((book, idx) => {
      book.load(bookMaker({
        slug: slugs[idx],
        title: titles[idx],
        licenseUrl: idx === 0
          ? 'http://creativecommons.org/licenses/by/4.0'
          : 'http://creativecommons.org/licenses/by-nd/4.0'
      }))
    })

    let err: Error | undefined
    try {
      generateReadmeForWorkspace(bundle.books.toArray())
    } catch (e) {
      err = e as Error
    }

    expect(err).toBeDefined()
    err = err as Error
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    expect(err.toString()).toBe('Error: Licenses differ between collections')
  })

  it('fails for empty book set', () => {
    let err: Error | undefined
    try {
      generateReadmeForWorkspace([])
    } catch (e) {
      err = e as Error
    }
    expect(err).toBeDefined()
    err = err as Error
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    expect(err.toString()).toBe('Error: Got empty book set when generating README')
  })
})
