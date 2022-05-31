import expect from 'expect'
import * as xpath from 'xpath-ts'
import { DOMParser } from 'xmldom'
import { calculateElementPositions } from './utils'
import { ignoreConsoleWarnings, loadSuccess, makeBundle } from './spec-helpers.spec'

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
