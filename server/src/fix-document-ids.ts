import { DOMParser, XMLSerializer } from 'xmldom'
import { ELEMENT_TO_PREFIX } from './model/page'
import { expectValue, select } from './model/utils'

const ID_PADDING_CHARS = 5

export function padLeft(text: string, padChar: string, size: number): string {
  if (text.length < size) {
    return (String(padChar).repeat(size) + text).substr((size * -1), size)
  } else {
    return text
  }
}

function buildId(tag: string, counter: number): string {
  const prefix = expectValue(ELEMENT_TO_PREFIX.get(tag), 'BUG: Element was not in the id-prefix map')
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

export function idFixer(input: string) {
  const doc = new DOMParser().parseFromString(input)
  // == fix xml ==
  fixDocument(doc)
  // == save xml ==
  const out = new XMLSerializer().serializeToString(doc)
  /* istanbul ignore if */
  if (out === input) {
    throw new Error('BUG! We wrote a file that did not change')
  }
  return out
}
