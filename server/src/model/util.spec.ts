import { readFileSync } from 'fs'
import * as path from 'path'
import I from 'immutable'
import { PathHelper } from './utils'
import { Bundle } from './bundle'
import { Fileish } from './fileish'

const REPO_ROOT = path.join(__dirname, '..', '..', '..')

describe('Bugfixes', () => {
  it('clears parse errors when the file parses correctly', () => {
    const bundle = makeBundle()
    ignoreConsoleWarnings(() => {
      bundle.load('<invalid this-is-intentionally-invalid-XML content')
    })
    expect(bundle.validationErrors.errors.size).toBe(1)
    loadSuccess(bundle)
    expect(bundle.validationErrors.errors.size).toBe(0)
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
  expect(n.isLoaded).toBeFalsy()
  n.load(read(n.absPath))
  expect(n.isLoaded).toBeTruthy()
  expect(n.exists).toBeTruthy()
  expect(n.validationErrors.errors.size).toBe(0)
  return n // for daisy-chaining
}

export function ignoreConsoleWarnings(fn: () => void) {
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
  fn()
  warnSpy.mockRestore()
}

export function expectErrors<T extends Fileish>(node: T, messages: string[]) {
  const v = node.validationErrors
  expect(v.nodesToLoad.size).toBe(0) // Everything should have loaded
  expect(v.errors.map(e => e.message).toArray().sort()).toEqual(messages.sort())
}
