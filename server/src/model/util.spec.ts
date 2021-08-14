import { readFileSync } from 'fs'
import * as path from 'path'
import I from 'immutable'
import { PathHelper } from './utils'
import { Bundle } from './bundle'
import { Fileish } from './fileish'

const REPO_ROOT = path.join(__dirname, '..', '..', '..')

describe('Book validations', () => {
  it.skip('Missing page', () => {})
  it.skip('Duplicate chapter title', () => {})
  it.skip('Duplicate page', () => {})
})

describe('Bundle validations', () => {
  it.skip('Missing book', () => {})
  it.skip('No books are defiend', () => {})
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
