import * as xpath from 'xpath-ts'
import { expect } from './utils'

const ID_PADDING_CHARS = 5
const NS_COLLECTION = 'http://cnx.rice.edu/collxml'
const NS_CNXML = 'http://cnx.rice.edu/cnxml'
const NS_METADATA = 'http://cnx.rice.edu/mdml'
const select = xpath.useNamespaces({ cnxml: NS_CNXML, col: NS_COLLECTION, md: NS_METADATA })

const ELEMENT_TO_PREFIX = new Map<string, string>()
ELEMENT_TO_PREFIX.set('para', 'para')
ELEMENT_TO_PREFIX.set('equation', 'eq')
ELEMENT_TO_PREFIX.set('list', 'list')
ELEMENT_TO_PREFIX.set('section', 'sect')
ELEMENT_TO_PREFIX.set('problem', 'prob')
ELEMENT_TO_PREFIX.set('solution', 'sol')
ELEMENT_TO_PREFIX.set('exercise', 'exer')
ELEMENT_TO_PREFIX.set('example', 'exam')
ELEMENT_TO_PREFIX.set('figure', 'fig')
ELEMENT_TO_PREFIX.set('definition', 'def')
ELEMENT_TO_PREFIX.set('term', 'term') // This should just be added to terms in the normal text, not inside a definition
ELEMENT_TO_PREFIX.set('table', 'table')
ELEMENT_TO_PREFIX.set('quote', 'quote')
ELEMENT_TO_PREFIX.set('note', 'note')
ELEMENT_TO_PREFIX.set('footnote', 'foot')
ELEMENT_TO_PREFIX.set('cite', 'cite')

export function padLeft(text: string, padChar: string, size: number): string {
  if (text.length < size) {
    return (String(padChar).repeat(size) + text).substr((size * -1), size)
  } else {
    return text
  }
}

function buildId(tag: string, counter: number): string {
  const prefix = expect(ELEMENT_TO_PREFIX.get(tag), 'BUG: Element was not in the id-prefix map')
  return `${prefix}-${padLeft(String(counter), '0', ID_PADDING_CHARS)}`
}

// Do not add ids to <term> inside a definition.
function termSpecificSelector(e: string): string {
  return e === 'term' ? '[not(parent::cnxml:definition)]' : ''
}

export function fixDocument(doc: Document): void {
  const elsWithIds = select('//cnxml:*[@id]', doc) as Element[]
  const ids = new Set(elsWithIds.map(el => el.getAttribute('id')))
  const xpath = Array.from(ELEMENT_TO_PREFIX.keys()).map(e => `//cnxml:${e}[not(@id)]${termSpecificSelector(e)}`).join('|')
  const els = select(xpath, doc) as Element[]
  const cacheHighId: { [tag: string]: number } = {}
  for (const el of els) {
    const tag = el.tagName.toLowerCase()
    let counter = cacheHighId[tag] > 0 ? cacheHighId[tag] + 1 : 1
    while (ids.has(buildId(tag, counter))) {
      counter++
    }
    ids.add(buildId(tag, counter)) // avoid reusage of new generated id
    cacheHighId[tag] = counter // cache new highest counter
    el.setAttribute('id', buildId(tag, counter))
  }
}
