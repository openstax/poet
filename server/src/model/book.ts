import I from 'immutable'
import * as Quarx from 'quarx'
import { PageNode } from './page'
import { Opt, WithRange, textWithRange, select, selectOne, findDuplicates, calculateElementPositions, expectValue, HasRange, join, equalsOpt, equalsWithRange, tripleEq, equalsPos, equalsArray, PathKind, TocNodeKind } from './utils'
import { Fileish, ValidationCheck, ValidationKind } from './fileish'

const equalsTocNodeWithRange = (n1: TocNodeWithRange, n2: TocNodeWithRange): boolean => {
  /* istanbul ignore else */
  if (n1.type === TocNodeKind.Subbook) {
    /* istanbul ignore next */
    if (n2.type !== n1.type) return false
    /* istanbul ignore next */
    return equalsPos(n1.range.start, n2.range.start) && equalsPos(n1.range.end, n2.range.end) && n1.title === n2.title && equalsArrayToc(n1.children, n2.children)
  } else {
    /* istanbul ignore next */
    if (n2.type !== n1.type) return false
    /* istanbul ignore next */
    return equalsPos(n1.range.start, n2.range.start) && equalsPos(n1.range.end, n2.range.end) && n1.page === n2.page
  }
}
const equalsArrayToc = equalsArray(equalsTocNodeWithRange)
const equalsOptArrayToc = equalsOpt(equalsArrayToc)
const equalsOptWithRange = equalsOpt(equalsWithRange(tripleEq))

export type TocNodeWithRange = TocPageWithRange | TocSubbookWithRange
export type TocSubbookWithRange = HasRange & { readonly type: TocNodeKind.Subbook, title: string, children: TocNodeWithRange[] }
export type TocPageWithRange = HasRange & { readonly type: TocNodeKind.Page, readonly page: PageNode }

export class BookNode extends Fileish {
  private readonly _uuid = Quarx.observable.box<Opt<WithRange<string>>>(undefined, { equals: equalsOptWithRange })
  private readonly _title = Quarx.observable.box<Opt<WithRange<string>>>(undefined, { equals: equalsOptWithRange })
  private readonly _slug = Quarx.observable.box<Opt<WithRange<string>>>(undefined, { equals: equalsOptWithRange })
  private readonly _language = Quarx.observable.box<Opt<WithRange<string>>>(undefined, { equals: equalsOptWithRange })
  private readonly _licenseUrl = Quarx.observable.box<Opt<WithRange<string>>>(undefined, { equals: equalsOptWithRange })
  private readonly _toc = Quarx.observable.box<Opt<TocNodeWithRange[]>>(undefined, { equals: equalsOptArrayToc })

  protected parseXML = (doc: Document) => {
    this._uuid.set(textWithRange(selectOne('/col:collection/col:metadata/md:uuid', doc)))
    this._title.set(textWithRange(selectOne('/col:collection/col:metadata/md:title', doc)))
    this._slug.set(textWithRange(selectOne('/col:collection/col:metadata/md:slug', doc)))
    this._language.set(textWithRange(selectOne('/col:collection/col:metadata/md:language', doc)))
    this._licenseUrl.set(textWithRange(selectOne('/col:collection/col:metadata/md:license', doc), 'url'))
    const root: Element = selectOne('/col:collection/col:content', doc)
    this._toc.set(this.buildChildren(root))
  }

  private buildChildren(root: Element): TocNodeWithRange[] {
    const ret = (select('./col:*', root) as Element[]).map((childNode): TocNodeWithRange => {
      const range = calculateElementPositions(childNode)
      switch (childNode.localName) {
        case 'subcollection': {
          const titleNode = selectOne('md:title', childNode)
          const range = calculateElementPositions(titleNode)
          return {
            type: TocNodeKind.Subbook,
            title: expectValue(titleNode.textContent, 'ERROR: Malformed or missing md:title element in Subcollection'),
            children: this.buildChildren(selectOne('./col:content', childNode)),
            range
          }
        }
        case 'module': {
          const pageId = expectValue(selectOne('@document', childNode).nodeValue, 'BUG: missing @document on col:module')
          const page = super.bundle().allPages.getOrAdd(join(this.pathHelper, PathKind.COLLECTION_TO_MODULEID, this.absPath, pageId))
          return {
            type: TocNodeKind.Page,
            page,
            range
          }
        }
        /* istanbul ignore next */
        default:
          /* istanbul ignore next */
          throw new Error(`ERROR: Unknown element in the ToC. '${childNode.localName}'`)
      }
    })
    return ret
  }

  private get __toc() {
    return this.ensureLoaded(this._toc)
  }

  public get toc(): TocNodeWithRange[] {
    return this.__toc
  }

  public get uuid() {
    return this.ensureLoaded(this._uuid).v
  }

  public get title() {
    return this.ensureLoaded(this._title).v
  }

  public get slug() {
    return this.ensureLoaded(this._slug).v
  }

  public get language() {
    return this.ensureLoaded(this._language).v
  }

  public get licenseUrl() {
    return this.ensureLoaded(this._licenseUrl).v
  }

  public get pages() {
    return this.tocLeaves().map(l => l.page)
  }

  private tocLeaves() {
    return I.List<TocPageWithRange>().withMutations(acc => this.collectPages(this.__toc, acc))
  }

  private collectPages(nodes: TocNodeWithRange[], acc: I.List<TocPageWithRange>) {
    nodes.forEach(n => {
      if (n.type === TocNodeKind.Page) { acc.push(n) } else { this.collectPages(n.children, acc) }
    })
  }

  private collectNonPages(nodes: TocNodeWithRange[], acc: I.List<TocSubbookWithRange>) {
    nodes.forEach(n => {
      if (n.type !== TocNodeKind.Page) {
        acc.push(n)
        this.collectNonPages(n.children, acc)
      }
    })
  }

  protected getValidationChecks(): ValidationCheck[] {
    const pages = this.pages
    const nonPages = I.List<TocSubbookWithRange>().withMutations(acc => this.collectNonPages(this.__toc, acc))
    const duplicateTitles = I.Set(findDuplicates(nonPages.map(subcol => subcol.title)))
    const pageLeaves = I.List<TocPageWithRange>().withMutations(acc => this.collectPages(this.__toc, acc))
    const duplicatePages = I.Set(findDuplicates(pages))
    return [
      {
        message: BookValidationKind.MISSING_PAGE,
        nodesToLoad: I.Set(pages),
        fn: () => I.Set(this.tocLeaves()).filter(p => !p.page.exists).map(l => l.range)
      },
      {
        message: BookValidationKind.DUPLICATE_CHAPTER_TITLE,
        nodesToLoad: I.Set(),
        fn: () => I.Set(nonPages.filter(subcol => duplicateTitles.has(subcol.title)).map(l => l.range))
      },
      {
        message: BookValidationKind.DUPLICATE_PAGE,
        nodesToLoad: I.Set(),
        fn: () => I.Set(pageLeaves.filter(p => duplicatePages.has(p.page)).map(l => l.range))
      }
    ]
  }
}

export class BookValidationKind extends ValidationKind {
  static MISSING_PAGE = new BookValidationKind('Missing Page')
  static DUPLICATE_CHAPTER_TITLE = new BookValidationKind('Duplicate chapter title')
  static DUPLICATE_PAGE = new BookValidationKind('Duplicate page')
}
