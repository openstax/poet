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

function padLeft(text: string, padChar: string, size: number): string {
  return (String(padChar).repeat(size) + text).substr((size * -1), size)
}
function buildId(tag: string, counter: number): string {
  const prefix = expect(ELEMENT_TO_PREFIX.get(tag), 'BUG: Element was not in the id-prefix map')
  return `${prefix}-${padLeft(String(counter), '0', ID_PADDING_CHARS)}`
}

function isIdAttributeExisting(doc: Document, id: string): boolean {
  const checkElements = select(`//*[@id="${id}"]`, doc) as Element[]
  return checkElements.length > 0
}

export function fixDocument(doc: Document): void {
  const xpath = Array.from(ELEMENT_TO_PREFIX.keys()).map(e => `//cnxml:${e}[not(@id)]`).join('|')
  const els = select(xpath, doc) as Element[]
  for (const el of els) {
    const tag = el.tagName.toLowerCase()
    let counter = 1
    while (isIdAttributeExisting(doc, buildId(tag, counter))) {
      counter++
    }
    el.setAttribute('id', buildId(tag, counter))
  }
}

// // $ npx ts-node server/src/fix-document-ids.ts
// import { DOMParser, XMLSerializer } from 'xmldom'
// const doc = new DOMParser().parseFromString('<document xmlns="http://cnx.rice.edu/cnxml"><term>hi</term></document>', 'text/xml')
// fixDocument(doc)
// const out = new XMLSerializer().serializeToString(doc)
// console.log(out)
