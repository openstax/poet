import I from 'immutable'
import * as Quarx from 'quarx'
import { Opt, Position, PathKind, WithRange, textWithRange, select, selectOne, calculateElementPositions, expectValue, HasRange, NOWHERE, join, equalsOpt, equalsWithRange, tripleEq, Range } from './utils'
import { Fileish, ValidationCheck, ValidationKind, ValidationSeverity } from './fileish'
import { ResourceNode } from './resource'

enum ResourceLinkKind {
  Image,
  IFrame
}
export type ResourceLink = ImageLink | IFrameLink
export interface ImageLink extends HasRange {
  type: ResourceLinkKind.Image
  target: ResourceNode
}
export interface IFrameLink extends HasRange {
  type: ResourceLinkKind.IFrame
  target: ResourceNode
}

export enum PageLinkKind {
  URL,
  PAGE,
  PAGE_ELEMENT,
  EXERCISE
}
export type PageLink = HasRange & ({
  type: PageLinkKind.URL
  url: string
} | {
  type: PageLinkKind.PAGE
  page: PageNode
} | {
  type: PageLinkKind.PAGE_ELEMENT
  page: PageNode
  targetElementId: string
} | {
  type: PageLinkKind.EXERCISE
  url: string
  tagName: string
})

/**
 * The fields we care about from a fetched Exercise
 */
interface ExerciseJSON {
  tags: string[]
  // version: number
  // number: number // Identifier for constructing a URL
}
export interface ExercisesJSON {
  items: ExerciseJSON[]
}
interface PagesAndTargets {
  pageUUIDs: string[]
  elementIDs: string[]
}

const LINKED_EXERCISE_PREFIX_URLS = ['#ost/api/ex/', '#exercise/']
export const EXERCISE_TAG_PREFIX_CONTEXT_PAGE_UUID = 'context-cnxmod'
export const EXERCISE_TAG_PREFIX_CONTEXT_ELEMENT_ID = 'context-cnxfeature'
export function exerciseTagToUrl(tagName: string) {
  return `https://exercises.openstax.org/api/exercises?q=tag:${tagName}`
}
/*
  * There are 2 types of exercise tags we care about:
  * - context-cnxmod:461e16d4-3f6a-4430-86ab-578e2035da57
  * - context-cnxfeature:CNX_AP_Bio_43_04_02
  *
  * Example: https://exercises.openstax.org/api/exercises?q=tag:apbio-ch34-ex038
  */
function getContextPagesAndTargets(ex: ExerciseJSON): PagesAndTargets {
  const pageUUIDs = []
  const elementIDs = []
  for (const tag of ex.tags) {
    const [prefix, value] = tag.split(':')
    switch (prefix) {
      case EXERCISE_TAG_PREFIX_CONTEXT_PAGE_UUID :
        pageUUIDs.push(value)
        break
      case EXERCISE_TAG_PREFIX_CONTEXT_ELEMENT_ID:
        elementIDs.push(value)
        break
    }
  }
  return { pageUUIDs, elementIDs }
}

function convertToPos(str: string, cursor: number): Position {
  const lines = str.substring(cursor).split('\n')
  return { line: lines.length, character: lines[lines.length - 1].length }
}

function filterNull<T>(set: I.Set<Opt<T>>): I.Set<T> {
  return I.Set<T>().withMutations(s => {
    set.forEach(s1 => {
      if (s1 !== undefined) {
        s.add(s1)
      }
    })
  })
}

export const UNTITLED_FILE = 'UntitledFile'

const equalsOptWithRange = equalsOpt(equalsWithRange(tripleEq))

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const ELEMENT_TO_PREFIX = new Map<string, string>()
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

// Do not add ids to <term> inside a definition.
function termSpecificSelector(e: string): string {
  return e === 'term' ? '[not(parent::cnxml:definition)]' : ''
}

export const ELEMENTS_MISSING_IDS_SEL = Array.from(ELEMENT_TO_PREFIX.keys()).map(e => `//cnxml:${e}[not(@id)]${termSpecificSelector(e)}`).join('|')
export class PageNode extends Fileish {
  private readonly _uuid = Quarx.observable.box<Opt<WithRange<string>>>(undefined, { equals: equalsOptWithRange })
  private readonly _title = Quarx.observable.box<Opt<WithRange<string>>>(undefined, { equals: equalsOptWithRange })
  private readonly _elementIds = Quarx.observable.box<Opt<I.Set<WithRange<string>>>>(undefined)
  private readonly _resourceLinks = Quarx.observable.box<Opt<I.Set<ResourceLink>>>(undefined)
  private readonly _pageLinks = Quarx.observable.box<Opt<I.Set<PageLink>>>(undefined)
  private readonly _elementsMissingIds = Quarx.observable.box<Opt<I.Set<Range>>>(undefined)
  private readonly _exerciseCache = Quarx.observable.box<I.Map<string, ExercisesJSON>>(I.Map())

  public uuid() { return this.ensureLoaded(this._uuid).v }
  public get optTitle() {
    const t = this._title.get()
    return t?.v
  }

  public title(fileReader: () => string) {
    // A quick way to get the title for the ToC
    const v = this._title.get()
    if (v === undefined) {
      const data = fileReader()
      return this.guessTitle(data)?.v ?? UNTITLED_FILE
    }
    return v.v
  }

  private guessTitle(data: string): Opt<WithRange<string>> {
    const openTag = '<title>'
    const closeTag = '</title>'
    const titleTagStart = data.indexOf(openTag)
    const titleTagEnd = data.indexOf(closeTag)
    if (titleTagStart === -1 || titleTagEnd === -1) {
      return
    }
    const actualTitleStart = titleTagStart + openTag.length
    /* istanbul ignore if */
    if (titleTagEnd - actualTitleStart > 280) {
      // If the title is so long you can't tweet it,
      // then something probably went wrong.
      /* istanbul ignore next */
      return
    }
    const range = {
      start: convertToPos(data, actualTitleStart),
      end: convertToPos(data, titleTagEnd)
    }
    return {
      v: data.substring(actualTitleStart, titleTagEnd).trim(),
      range
    }
  }

  public get resources() {
    return this.resourceLinks.map(l => l.target)
  }

  public get resourceLinks() {
    return this.ensureLoaded(this._resourceLinks)
  }

  public get pageLinks() {
    return this.ensureLoaded(this._pageLinks)
  }

  public get elementIds() {
    return I.Map(this.ensureLoaded(this._elementIds).map(v => [v.v, v]))
  }

  public hasElementId(id: string) {
    return this.ensureLoaded(this._elementIds).toSeq().find(n => n.v === id) !== undefined
  }

  protected parseXML = (doc: Document) => {
    this._uuid.set(textWithRange(selectOne('//md:uuid', doc)))

    this._elementIds.set(I.Set((select('//cnxml:*[@id]', doc) as Element[]).map(el => textWithRange(el, 'id'))))
    const missing = select(ELEMENTS_MISSING_IDS_SEL, doc) as Element[]
    this._elementsMissingIds.set(I.Set(missing.map(el => calculateElementPositions(el))))

    const toResourceLink = (type: ResourceLinkKind, attr: Attr): ResourceLink => {
      const src = expectValue(attr.nodeValue, 'BUG: Attribute does not have a value')
      const target = super.bundle.allResources.getOrAdd(join(this.pathHelper, PathKind.ABS_TO_REL, this.absPath, src))
      // Get the line/col position of the <image> tag
      const imageNode = expectValue(attr.ownerElement, 'BUG: attributes always have a parent element')
      const range = calculateElementPositions(imageNode)
      return { type, target, range }
    }

    const imageNodes = select('//cnxml:image/@src', doc) as Attr[]
    const iframeNodes = select('//cnxml:iframe/@src[not(starts-with(., "https://") or starts-with(., "http://"))]', doc) as Attr[]
    const imageLinks = imageNodes.map(n => toResourceLink(ResourceLinkKind.Image, n))
    const iframeLinks = iframeNodes.map(n => toResourceLink(ResourceLinkKind.IFrame, n))

    this._resourceLinks.set(I.Set([...imageLinks, ...iframeLinks]))

    const linkNodes = select('//cnxml:link', doc) as Element[]
    const changeEmptyToNull = (str: string | null): Opt<string> => (str === '' || str === null) ? undefined : str
    this._pageLinks.set(I.Set(linkNodes.map(linkNode => {
      const range = calculateElementPositions(linkNode)
      // xmldom never returns null, it returns ''
      const toDocument = changeEmptyToNull(linkNode.getAttribute('document'))
      const toTargetId = changeEmptyToNull(linkNode.getAttribute('target-id'))
      const toUrl = changeEmptyToNull(linkNode.getAttribute('url'))
      if (toUrl !== undefined) {
        for (const prefix of LINKED_EXERCISE_PREFIX_URLS) {
          if (toUrl.startsWith(prefix)) {
            const tagName = toUrl.substring(prefix.length)
            return { range, type: PageLinkKind.EXERCISE, tagName, url: exerciseTagToUrl(tagName) }
          }
        }
        return { range, type: PageLinkKind.URL, url: toUrl }
      }
      const toPage = toDocument !== undefined ? super.bundle.allPages.getOrAdd(join(this.pathHelper, PathKind.MODULE_TO_MODULEID, this.absPath, toDocument)) : this
      if (toTargetId !== undefined) {
        return {
          range,
          type: PageLinkKind.PAGE_ELEMENT,
          page: toPage,
          targetElementId: toTargetId
        }
      } else {
        return { range, type: PageLinkKind.PAGE, page: toPage }
      }
    })))

    const titleNode = select('//cnxml:title', doc) as Element[]
    if (titleNode.length > 0) {
      this._title.set(textWithRange(titleNode[0]))
    } else {
      this._title.set({
        v: UNTITLED_FILE,
        range: NOWHERE
      })
    }
  }

  get exerciseUrls() {
    const pageLinks = this.ensureLoaded(this._pageLinks)
    const ret = I.Set<string>().withMutations(s => {
      for (const l of pageLinks) {
        if (l.type === PageLinkKind.EXERCISE) {
          s.add(l.url)
        }
      }
    })
    return ret
  }

  setExercises(cache: I.Map<string, ExercisesJSON>) {
    this._exerciseCache.set(cache)
  }

  protected getValidationChecks(): ValidationCheck[] {
    const exerciseCache = this._exerciseCache.get()
    const resourceLinks = this.resourceLinks
    const pageLinks = this.pageLinks
    return [
      {
        message: PageValidationKind.MISSING_RESOURCE,
        nodesToLoad: resourceLinks.map(l => l.target),
        fn: () => resourceLinks.filter(img => !img.target.exists).map(l => l.range)
      },
      {
        message: PageValidationKind.MISSING_TARGET,
        nodesToLoad: filterNull(pageLinks.map(l => {
          if (l.type !== PageLinkKind.URL && l.type !== PageLinkKind.EXERCISE && l.page !== this) {
            return l.page
          }
          return undefined
        })),
        fn: () => pageLinks.filter(l => {
          if (l.type === PageLinkKind.URL) return l.url.startsWith('#') // URL links are ok
          if (l.type === PageLinkKind.EXERCISE) return false // We check these in a different validation
          if (!l.page.exists) return true // link to non-existent page are bad
          if (l.type === PageLinkKind.PAGE) return false // linking to the whole page and it exists is ok
          return !l.page.hasElementId(l.targetElementId)
        }).map(l => l.range)
      },
      {
        message: PageValidationKind.MALFORMED_EXERCISE,
        nodesToLoad: this.bundle.allPages.all,
        fn: () => pageLinks.filter(l => {
          if (l.type === PageLinkKind.EXERCISE) {
            const exercises = exerciseCache.get(l.url)
            if (exercises === undefined) {
              return true // Error: Exercise has not been loaded by now. Could be a bug or an error from server
            }
            if (exercises.items.length !== 1) {
              return true // Error: Expected 1 exercise result but found 0 or at least 2
            }
            const { pageUUIDs, elementIDs } = getContextPagesAndTargets(exercises.items[0])
            // If there is at least one pageUUID then ensure at least one of them is in our book
            if (pageUUIDs.length > 0) {
              const contextPages = this.bundle.allPages.all.filter(p => pageUUIDs.includes(p.uuid()))
              if (contextPages.size < 1) {
                return true // Error: Did not find any pages in our bundle for the context for this exercise
              }
              for (const p of contextPages) {
                for (const id of elementIDs) {
                  if (!p.elementIds.has(id)) {
                    return true // Error: context-feature does not exist in the target page 'p'
                  }
                }
              }
              if (contextPages.size === 0 || elementIDs.length === 0) {
                return true // Error: There were no context element IDs
              }
            } else {
              // Check if the ID in the Exercise matches one on this Page
              const elementIds = Array.from(this.elementIds.keys())
              for (const targetId of elementIDs) {
                if (!elementIds.includes(targetId)) {
                  return true // Error: Exercise contains a context element ID but that ID is not available on this Page
                }
              }
            }
          }
          return false
        }).map(l => l.range)
      },
      {
        message: PageValidationKind.MALFORMED_UUID,
        nodesToLoad: I.Set(),
        fn: () => {
          const uuid = this.ensureLoaded(this._uuid)
          return UUID_RE.test(uuid.v) ? I.Set() : I.Set([uuid.range])
        }
      },
      {
        message: PageValidationKind.DUPLICATE_UUID,
        nodesToLoad: I.Set(),
        fn: () => {
          const uuid = this.ensureLoaded(this._uuid)
          if (this.bundle.isDuplicateUuid(uuid.v)) {
            return I.Set([uuid.range])
          } else {
            return I.Set()
          }
        }
      },
      {
        message: PageValidationKind.MISSING_ID,
        nodesToLoad: I.Set(),
        fn: () => {
          return this.ensureLoaded(this._elementsMissingIds)
        }
      }
    ]
  }
}
export class PageValidationKind extends ValidationKind {
  static MISSING_RESOURCE = new PageValidationKind('Target resource file does not exist')
  static MISSING_TARGET = new PageValidationKind('Link target does not exist')
  static MALFORMED_EXERCISE = new PageValidationKind('Malformed or Missing Exercise. Probably context-feature tag is not on this page or this page is not in the context-mod tags')
  static MALFORMED_UUID = new PageValidationKind('Malformed UUID')
  static DUPLICATE_UUID = new PageValidationKind('Duplicate Page/Module UUID')
  static MISSING_ID = new PageValidationKind('Missing ID attribute', ValidationSeverity.INFORMATION)
}
