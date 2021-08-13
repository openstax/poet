import { readFileSync } from 'fs'
import * as path from 'path'
import I from 'immutable'
import { Bundle, Factory, Fileish, PageNode, PathHelper } from './model'

const REPO_ROOT = path.join(__dirname, '..', '..')

describe('Page', () => {
  let page = null as unknown as PageNode
  beforeEach(() => {
    page = new PageNode(makeBundle(), FS_PATH_HELPER, '/some/path/filename')
  })

  describe('Page validations', () => {
    it.skip('Missing image', () => {})
    it.skip('Link target not found', () => {})
    it.skip('Malformed UUID', () => {})
    it.skip('Duplicate Page/Module UUID', () => {})
  })

  it('can return a title before being loaded', () => {
    const quickTitle = 'quick title'
    expect(page.isLoaded()).toBe(false)
    const title = page.title(() => `a regexp reads this string so it does not have to be XML <title>${quickTitle}</title>.`)
    expect(title).toBe(quickTitle)
    expect(page.isLoaded()).toBe(false)
  })
  it('falls back if the quick-title did not find a title', () => {
    const quickTitle = 'quick title'
    expect(page.isLoaded()).toBe(false)
    let title = page.title(() => 'no title element to be seen in this contents')
    expect(title).toBe('UntitledFile')
    title = page.title(() => `<title>${quickTitle}</title>`)
    expect(title).toBe(quickTitle)
    title = page.title(() => 'Just an opening <title>but no closing tag')
    expect(title).toBe('UntitledFile')
    expect(page.isLoaded()).toBe(false)
  })
})

describe('Book validations', () => {
  it.skip('Missing page', () => {})
  it.skip('Duplicate chapter title', () => {})
  it.skip('Duplicate page', () => {})
})

describe('Bundle validations', () => {
  it.skip('Missing book', () => {})
  it.skip('No books are defiend', () => {})
})

describe('Factory', () => {
  it('instantiates a new object when the key does not exist', () => {
    let counter = 0
    const f = new Factory(() => ({ thing: counter++ }))
    expect(f.getIfHas('key1')).toBeUndefined()
    expect(f.get('key1').thing).toEqual(0)
    expect(f.getIfHas('key1')).not.toBeUndefined()
    expect(f.get('key1').thing).toEqual(0)

    expect(f.getIfHas('key2')).toBeUndefined()
    expect(f.get('key2').thing).toEqual(1)
    expect(f.getIfHas('key2')).not.toBeUndefined()
  })
  it('removesByKeyPrefix works', () => {
    const f = new Factory((x) => ({ foo: x, bar: 'dummy-object' }))
    f.get('keyPrefix1')
    f.get('keyPrefix2')
    f.get('anotherprefix')
    f.get('not_a_keyPrefix')

    expect(f.all().size).toEqual(4)
    f.removeByKeyPrefix('keyPrefix')
    expect(f.all().size).toEqual(2)
  })
})

describe('Happy path', () => {
  let bundle = null as unknown as Bundle

  beforeEach(() => {
    bundle = makeBundle()
    bundle.load(read(bundle.absPath))
  })
  it('loads the book bundle', () => {
    expect(bundle.exists()).toBeTruthy()
    expect(bundle.isLoaded()).toBeTruthy()
    expect(bundle.books().size).toBe(1)
  })
  it('loads the Book', () => {
    const book = first(bundle.books())
    loadSuccess(book)
  })
  it('loads a Page', () => {
    const book = loadSuccess(first(bundle.books()))
    const page = first(book.pages())
    loadSuccess(page)
  })
})

describe('The abstract ancestor class', () => {
  class MyNode extends Fileish {
    protected getValidationChecks() { return [] }
  }

  it('marks a missing file as loaded but not existing', () => {
    const f = new MyNode(makeBundle(), FS_PATH_HELPER, '/to/nowhere/filename')
    expect(f.isLoaded()).toBe(false)
    expect(f.exists()).toBe(false)
    f.load(undefined)
    expect(f.isLoaded()).toBe(true)
    expect(f.exists()).toBe(false)
  })
  it('marks a file as loaded if there is no parseXML method', () => {
    const f = new MyNode(makeBundle(), FS_PATH_HELPER, '/to/nowhere/filename')
    f.load('the contents of a beutiful sunset')
    expect(f.exists()).toBe(true)
  })
})

describe('Bugfixes', () => {
  it('clears parse errors when the file parses correctly', () => {
    const bundle = makeBundle()
    ignoreConsoleWarnings(() => {
      bundle.load('<invalid this-is-intentionally-invalid-XML content')
    })
    expect(bundle.getValidationErrors().errors.size).toBe(1)
    loadSuccess(bundle)
    expect(bundle.getValidationErrors().errors.size).toBe(0)
  })
})

export const read = (filePath: string) => readFileSync(filePath, 'utf-8')

export const FS_PATH_HELPER: PathHelper<string> = {
  join: path.join,
  dirname: path.dirname
}

export function first<T>(col: I.Set<T> | I.List<T>) {
  const f = col.toArray()[0]
  expect(f).toBeTruthy()
  return f
}

export const makeBundle = () => new Bundle(FS_PATH_HELPER, REPO_ROOT)

export function loadSuccess<T extends Fileish>(n: T) {
  expect(n.isLoaded()).toBeFalsy()
  n.load(read(n.absPath))
  expect(n.isLoaded()).toBeTruthy()
  expect(n.exists()).toBeTruthy()
  expect(n.getValidationErrors().errors.size).toBe(0)
  return n // for daisy-chaining
}

export function ignoreConsoleWarnings(fn: () => void) {
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
  fn()
  warnSpy.mockRestore()
}
