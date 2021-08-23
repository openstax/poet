import I from 'immutable'
import { PageNode } from './page'
import { Opt, PathKind, WithRange, textWithSource, select, selectOne, findDuplicates, calculateElementPositions, expectValue, HasRange, join } from './utils'
import { Fileish, ValidationCheck } from './fileish'

export enum TocNodeKind {
  Inner,
  Leaf
}
export type TocNode = TocInner | TocLeaf
interface TocInner extends HasRange { readonly type: TocNodeKind.Inner, readonly title: string, readonly children: TocNode[] }
interface TocLeaf extends HasRange { readonly type: TocNodeKind.Leaf, readonly page: PageNode }

export class BookNode extends Fileish {
  private _title: Opt<WithRange<string>>
  private _slug: Opt<WithRange<string>>
  private _toc: Opt<TocNode[]>

  protected parseXML = (doc: Document) => {
    this._title = textWithSource(selectOne('/col:collection/col:metadata/md:title', doc))
    this._slug = textWithSource(selectOne('/col:collection/col:metadata/md:slug', doc))
    const root: Element = selectOne('/col:collection/col:content', doc)
    this._toc = this.buildChildren(root)
  }

  private buildChildren(root: Element): TocNode[] {
    const ret = (select('./col:*', root) as Element[]).map((childNode): TocNode => {
      const range = calculateElementPositions(childNode)
      switch (childNode.localName) {
        case 'subcollection': {
          const titleNode = selectOne('md:title', childNode)
          const range = calculateElementPositions(titleNode)
          return {
            type: TocNodeKind.Inner,
            title: expectValue(titleNode.textContent, 'ERROR: Malformed or missing md:title element in Subcollection'),
            children: this.buildChildren(selectOne('./col:content', childNode)),
            range
          }
        }
        case 'module': {
          const pageId = expectValue(selectOne('@document', childNode).nodeValue, 'BUG: missing @document on col:module')
          const page = super.bundle.allPages.getOrAdd(join(this._pathHelper, PathKind.COLLECTION_TO_MODULEID, this.absPath, pageId))
          return {
            type: TocNodeKind.Leaf,
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

  public get toc() {
    return this.ensureLoaded(this._toc)
  }

  public get title() {
    return this.ensureLoaded(this._title).v
  }

  public get slug() {
    return this.ensureLoaded(this._slug).v
  }

  public get pages() {
    return this.tocLeaves().map(l => l.page)
  }

  private tocLeaves() {
    const toc = this.toc
    return I.List<TocLeaf>().withMutations(acc => this.collectPages(toc, acc))
  }

  private collectPages(nodes: TocNode[], acc: I.List<TocLeaf>) {
    nodes.forEach(n => {
      if (n.type === TocNodeKind.Leaf) { acc.push(n) } else { this.collectPages(n.children, acc) }
    })
  }

  private collectNonPages(nodes: TocNode[], acc: I.List<TocInner>) {
    nodes.forEach(n => {
      if (n.type !== TocNodeKind.Leaf) {
        acc.push(n)
        this.collectNonPages(n.children, acc)
      }
    })
  }

  protected getValidationChecks(): ValidationCheck[] {
    const pages = this.pages
    const nonPages = I.List<TocInner>().withMutations(acc => this.collectNonPages(this.toc, acc))
    const duplicateTitles = I.Set(findDuplicates(nonPages.map(subcol => subcol.title)))
    const pageLeaves = I.List<TocLeaf>().withMutations(acc => this.collectPages(this.toc, acc))
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

export enum BookValidationKind {
  MISSING_PAGE = 'Missing Page',
  DUPLICATE_CHAPTER_TITLE = 'Duplicate chapter title',
  DUPLICATE_PAGE = 'Duplicate page',
}
