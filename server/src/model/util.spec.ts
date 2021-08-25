import { readFileSync } from 'fs'
import * as path from 'path'
import * as xpath from 'xpath-ts'
import { DOMParser } from 'xmldom'
import I from 'immutable'
import { PathHelper, calculateElementPositions } from './utils'
import { Bundle } from './bundle'
import { Fileish } from './fileish'

const REPO_ROOT = path.join(__dirname, '..', '..', '..')

describe('calculateElementPositions', function () {
  it('should return start and end positions using siblings when available', () => {
    const xmlContent = `
      <document>
        <content>
          <image src="" />
        </content>
      </document>
    `
    const xmlData = new DOMParser().parseFromString(xmlContent)
    const elements = xpath.select('//image', xmlData) as Element[]
    const imageElement = elements[0]
    expect(imageElement.nextSibling).not.toBe(null)
    const expected = {
      start: { line: 3, character: 10 },
      end: { line: 3, character: 26 }
    }
    const result = calculateElementPositions(imageElement)
    expect(result).toEqual(expected)
  })
  it('should return start and end positions based on attributes when no siblings', () => {
    const xmlContent = `
      <document>
        <content><image src="value" /></content>
      </document>
    `
    const xmlData = new DOMParser().parseFromString(xmlContent)
    const elements = xpath.select('//image', xmlData) as Node[]
    const imageElement = elements[0] as Element

    expect(imageElement.nextSibling).toBe(null)
    const expected = {
      start: { line: 2, character: 17 },
      end: { line: 2, character: 35 }
    }
    const result = calculateElementPositions(imageElement)
    expect(result).toEqual(expected)
  })
  it('should return start and end positions based on tag when no siblings or attributes', () => {
    const xmlContent = `
      <document>
        <content><image /></content>
      </document>
    `
    const xmlData = new DOMParser().parseFromString(xmlContent)
    const elements = xpath.select('//image', xmlData) as Node[]
    const imageElement = elements[0] as Element

    expect(imageElement.nextSibling).toBe(null)
    const expected = {
      start: { line: 2, character: 17 },
      end: { line: 2, character: 23 }
    }
    const result = calculateElementPositions(imageElement)
    expect(result).toEqual(expected)
  })
})

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
