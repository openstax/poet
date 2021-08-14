import I from 'immutable'
import { NOWHERE_START, NOWHERE_END, Opt, Position, PathType, Source, WithSource, textWithSource, select, selectOne, calculateElementPositions, expectValue } from './utils'
import { Fileish, ValidationCheck } from './fileish'
import { ImageNode } from './image'

export interface ImageLink extends Source {
  image: ImageNode
}

export interface PageLink extends Source {
  page: Opt<PageNode>
  targetElementId: Opt<string>
  url: Opt<string>
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export class PageNode extends Fileish {
  private _uuid: Opt<WithSource<string>>
  private _title: Opt<WithSource<string>>
  private _elementIds: Opt<I.Set<WithSource<string>>>
  private _imageLinks: Opt<I.Set<ImageLink>>
  private _pageLinks: Opt<I.Set<PageLink>>
  public uuid() { return this.ensureLoaded(this._uuid).v }
  public title(fileReader: () => string) {
    // A quick way to get the title for the ToC
    if (this._title === undefined) {
      const data = fileReader()
      return this.guessTitle(data)?.v ?? UNTITLED_FILE
    }
    return this._title.v
  }

  private guessTitle(data: string): Opt<WithSource<string>> {
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
    return {
      v: data.substring(actualTitleStart, titleTagEnd).trim(),
      startPos: convertToPos(data, actualTitleStart),
      endPos: convertToPos(data, titleTagEnd)
    }
  }

  private get imageLinks() {
    return this.ensureLoaded(this._imageLinks)
  }

  private get pageLinks() {
    return this.ensureLoaded(this._pageLinks)
  }

  public hasElementId(id: string) {
    return this.ensureLoaded(this._elementIds).toSeq().find(n => n.v === id) !== undefined
  }

  protected parseXML = (doc: Document) => {
    this._uuid = textWithSource(selectOne('//md:uuid', doc))

    this._elementIds = I.Set((select('//cnxml:*[@id]', doc) as Element[]).map(el => textWithSource(el, 'id')))

    const imageNodes = select('//cnxml:image/@src', doc) as Attr[]
    this._imageLinks = I.Set(imageNodes.map(attr => {
      const src = expectValue(attr.nodeValue, 'BUG: Attribute does not have a value')
      const image = super.bundle.allImages.get(this.join(PathType.ABS_TO_REL, this.absPath, src))
      // Get the line/col position of the <image> tag
      const imageNode = expectValue(attr.ownerElement, 'BUG: attributes always have a parent element')
      const [startPos, endPos] = calculateElementPositions(imageNode)
      return { image, startPos, endPos }
    }))

    const linkNodes = select('//cnxml:link', doc) as Element[]
    const changeEmptyToNull = (str: string | null): Opt<string> => (str === '' || str === null) ? undefined : str
    this._pageLinks = I.Set(linkNodes.map(linkNode => {
      const [startPos, endPos] = calculateElementPositions(linkNode)
      // xmldom never returns null, it returns ''
      const toDocument = changeEmptyToNull(linkNode.getAttribute('document'))
      const toTargetId = changeEmptyToNull(linkNode.getAttribute('target-id'))
      const toUrl = changeEmptyToNull(linkNode.getAttribute('url'))
      return {
        page: toDocument !== undefined ? super.bundle.allPages.get(this.join(PathType.MODULE_TO_MODULEID, this.absPath, toDocument)) : (toTargetId !== undefined ? this : undefined),
        url: toUrl,
        targetElementId: toTargetId,
        startPos,
        endPos
      }
    }))

    const titleNode = select('//cnxml:title', doc) as Element[]
    if (titleNode.length > 0) {
      this._title = textWithSource(titleNode[0])
    } else {
      this._title = {
        v: UNTITLED_FILE,
        startPos: NOWHERE_START,
        endPos: NOWHERE_END
      }
    }
  }

  protected getValidationChecks(): ValidationCheck[] {
    const imageLinks = this.imageLinks
    const pageLinks = this.pageLinks
    return [
      {
        message: PageValidationKind.MISSING_IMAGE,
        nodesToLoad: imageLinks.map(l => l.image),
        fn: () => imageLinks.filter(img => !img.image.exists)
      },
      {
        message: PageValidationKind.MISSING_TARGET,
        nodesToLoad: filterNull(pageLinks.map(l => l.page)),
        fn: () => pageLinks.filter(l => {
          if (l.page === undefined) return false // URL links are ok
          if (!l.page.exists) return true // link to non-existent page are bad
          if (l.targetElementId === undefined) return false // linking to the whole page and it exists is ok
          return !l.page.hasElementId(l.targetElementId)
        })
      },
      {
        message: PageValidationKind.MALFORMED_UUID,
        nodesToLoad: I.Set(),
        fn: () => {
          const uuid = this.ensureLoaded(this._uuid)
          return UUID_RE.test(uuid.v) ? I.Set() : I.Set([uuid])
        }
      },
      {
        message: PageValidationKind.DUPLICATE_UUID,
        nodesToLoad: I.Set(),
        fn: () => {
          const uuid = this.ensureLoaded(this._uuid)
          if (this.bundle.isDuplicateUuid(uuid.v)) {
            return I.Set([uuid])
          } else {
            return I.Set()
          }
        }
      }
    ]
  }
}

export enum PageValidationKind {
  MISSING_IMAGE = 'Missing image',
  MISSING_TARGET = 'Link target not found',
  MALFORMED_UUID = 'Malformed UUID',
  DUPLICATE_UUID = 'Duplicate Page/Module UUID',
}
