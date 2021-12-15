import I, { hasIn } from 'immutable'
import * as Quarx from 'quarx'
import { Opt, Position, PathKind, WithRange, textWithRange, select, selectOne, calculateElementPositions, expectValue, HasRange, NOWHERE, join, equalsOpt, equalsWithRange, tripleEq, TocNodeKind, Range } from './utils'
import { Fileish, ValidationCheck } from './fileish'
import { ImageNode } from './image'
import { TocNodeWithRange } from './book'

export interface ImageLink extends HasRange {
  image: ImageNode
}

export enum PageLinkKind {
  URL,
  PAGE,
  PAGE_ELEMENT
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
})

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
export class PageNode extends Fileish {
  private readonly _uuid = Quarx.observable.box<Opt<WithRange<string>>>(undefined, { equals: equalsOptWithRange })
  private readonly _title = Quarx.observable.box<Opt<WithRange<string>>>(undefined, { equals: equalsOptWithRange })
  private readonly _elementIds = Quarx.observable.box<Opt<I.Set<WithRange<string>>>>(undefined)
  private readonly _imageLinks = Quarx.observable.box<Opt<I.Set<ImageLink>>>(undefined)
  private readonly _pageLinks = Quarx.observable.box<Opt<I.Set<PageLink>>>(undefined)
  private readonly _hasIntroduction = Quarx.observable.box<Opt<WithRange<boolean>>>(undefined, { equals: equalsOptWithRange })
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

  public get images() {
    return this.imageLinks.map(l => l.image)
  }

  public get imageLinks() {
    return this.ensureLoaded(this._imageLinks)
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

    const imageNodes = select('//cnxml:image/@src', doc) as Attr[]
    this._imageLinks.set(I.Set(imageNodes.map(attr => {
      const src = expectValue(attr.nodeValue, 'BUG: Attribute does not have a value')
      const image = super.bundle.allImages.getOrAdd(join(this.pathHelper, PathKind.ABS_TO_REL, this.absPath, src))
      // Get the line/col position of the <image> tag
      const imageNode = expectValue(attr.ownerElement, 'BUG: attributes always have a parent element')
      const range = calculateElementPositions(imageNode)
      return { image, range }
    })))

    const linkNodes = select('//cnxml:link', doc) as Element[]
    const changeEmptyToNull = (str: string | null): Opt<string> => (str === '' || str === null) ? undefined : str
    this._pageLinks.set(I.Set(linkNodes.map(linkNode => {
      const range = calculateElementPositions(linkNode)
      // xmldom never returns null, it returns ''
      const toDocument = changeEmptyToNull(linkNode.getAttribute('document'))
      const toTargetId = changeEmptyToNull(linkNode.getAttribute('target-id'))
      const toUrl = changeEmptyToNull(linkNode.getAttribute('url'))
      if (toUrl !== undefined) {
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

    const docRoot = selectOne('//cnxml:document', doc) as Element
    const docClass = docRoot.getAttribute('class')
    const hasIntroduction = docClass !== null && docClass.indexOf('introduction') >= 0
    const introRange = calculateElementPositions(docRoot)
    this._hasIntroduction.set({
      range: introRange,
      v: hasIntroduction
    })

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

  protected getValidationChecks(): ValidationCheck[] {
    const imageLinks = this.imageLinks
    const pageLinks = this.pageLinks
    return [
      {
        message: PageValidationKind.MISSING_INTRO,
        nodesToLoad: I.Set<Fileish>(),
        fn: () => {
          // Find all the books this page is in
          // If it's the first page in a chapter then error (return the range) if this page does not have an introduction
          let ret = I.Set<Range>()
          const walker = (n: TocNodeWithRange) => {
            if (n.type === TocNodeKind.Subbook) {
              const firstChild = n.children[0]
              if (firstChild.type === TocNodeKind.Page) {
                // If we are the Page and we don't have introduction then error
                if (firstChild.page === this) {
                  const v = expectValue(this._hasIntroduction.get(), 'BUG: This Page should have already been loaded by now')
                  if (!v.v) {
                    ret = I.Set([v.range])
                  }
                }
                return
              }
              n.children.forEach(walker)
            }
          }

          if (this.bundle.isLoaded) {
            this.bundle.books.forEach(b => b.toc.forEach(walker))
          }

          return ret
        }
      },
      {
        message: PageValidationKind.MISSING_IMAGE,
        nodesToLoad: imageLinks.map(l => l.image),
        fn: () => imageLinks.filter(img => !img.image.exists).map(l => l.range)
      },
      {
        message: PageValidationKind.MISSING_TARGET,
        nodesToLoad: filterNull(pageLinks.map(l => {
          if (l.type !== PageLinkKind.URL && l.page !== this) {
            return l.page
          }
          return undefined
        })),
        fn: () => pageLinks.filter(l => {
          if (l.type === PageLinkKind.URL) return false // URL links are ok
          if (!l.page.exists) return true // link to non-existent page are bad
          if (l.type === PageLinkKind.PAGE) return false // linking to the whole page and it exists is ok
          return !l.page.hasElementId(l.targetElementId)
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
      }
    ]
  }
}

export enum PageValidationKind {
  MISSING_INTRO = 'class="introduction" missing',
  MISSING_IMAGE = 'Image file does not exist',
  MISSING_TARGET = 'Link target does not exist',
  MALFORMED_UUID = 'Malformed UUID',
  DUPLICATE_UUID = 'Duplicate Page/Module UUID',
}
