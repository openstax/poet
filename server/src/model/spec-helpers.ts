import expect from 'expect'
import SinonRoot from 'sinon'
import { readFileSync } from 'fs'
import * as path from 'path'
import I from 'immutable'
import { Bundle } from './bundle'
import { Fileish, ValidationKind } from './fileish'

export const REPO_ROOT = path.join(__dirname, '..', '..', '..')

export const read = (filePath: string) => readFileSync(filePath, 'utf-8')

/* Copy/Pasted from ./utils.ts to remove cyclic dependency */
interface PathHelper<T> {
  join: (root: T, ...components: string[]) => T
  dirname: (p: T) => T
  canonicalize: (p: T) => T
}

export const FS_PATH_HELPER: PathHelper<string> = {
  join: path.join,
  dirname: path.dirname,
  canonicalize: (x) => x
}

export function first<T>(col: I.Set<T> | I.List<T>) {
  const f = col.toArray()[0]
  expect(f).toBeTruthy()
  return f
}

export const makeBundle = () => new Bundle(FS_PATH_HELPER, REPO_ROOT)

export function loadSuccess<T extends Fileish>(n: T, skipInitialLoadedCheck = false, expectedErrorCount = 0) {
  if (!skipInitialLoadedCheck) expect(n.isLoaded).toBeFalsy()
  n.load(read(n.absPath))
  expect(n.isLoaded).toBeTruthy()
  expect(n.exists).toBeTruthy()
  expect(n.validationErrors.errors.size).toBe(expectedErrorCount)
  return n // for daisy-chaining
}

export function ignoreConsoleWarnings(fn: () => void) {
  const warnStub = SinonRoot.stub(console, 'warn')
  fn()
  warnStub.restore()
}

export function expectErrors<T extends Fileish>(node: T, validationKinds: ValidationKind[]) {
  const v = node.validationErrors
  expect(v.nodesToLoad.size).toBe(0) // Everything should have loaded
  expect(v.errors.toArray().map(e => e.message).sort()).toEqual(validationKinds.map(v => v.title).sort())
}
