import I from 'immutable'
import { PageNode } from './page'
import { Opt, PathType, Source, WithSource, textWithSource, select, selectOne, findDuplicates, calculateElementPositions, expect } from './utils'
import { Fileish, ValidationCheck } from './fileish'

export enum TocNodeType {
  Inner,
  Leaf
}
export type TocNode = TocInner | TocLeaf
interface TocInner extends Source { readonly type: TocNodeType.Inner, readonly title: string, readonly children: TocNode[] }
interface TocLeaf extends Source { readonly type: TocNodeType.Leaf, readonly page: PageNode }

export class BookNode extends Fileish {
  private _title: Opt<WithSource<string>>
  private _slug: Opt<WithSource<string>>
  private _toc: Opt<TocNode[]>

  protected childrenToLoad = () => I.Set(this.pages())
  protected parseXML = (doc: Document) => {
    this._title = textWithSource(selectOne('/col:collection/col:metadata/md:title', doc))
    this._slug = textWithSource(selectOne('/col:collection/col:metadata/md:slug', doc))
    const root: Element = selectOne('/col:collection/col:content', doc)
    this._toc = this.buildChildren(root)
  }

  private buildChildren(root: Element): TocNode[] {
    const ret = (select('./col:*', root) as Element[]).map((childNode): TocNode => {
      const [startPos, endPos] = calculateElementPositions(childNode)
      switch (childNode.localName) {
        case 'subcollection': {
          const titleNode = selectOne('md:title', childNode)
          const [startPos, endPos] = calculateElementPositions(titleNode)
          return {
            type: TocNodeType.Inner,
            title: expect(titleNode.textContent, 'ERROR: Malformed or missing md:title element in Subcollection'),
            children: this.buildChildren(selectOne('./col:content', childNode)),
            startPos,
            endPos
          }
        }
        case 'module': {
          const pageId = expect(selectOne('@document', childNode).nodeValue, 'BUG: missing @document on col:module')
          const page = super.bundle().allPages.get(this.join(PathType.COLLECTION_TO_MODULEID, this.absPath, pageId))
          return {
            type: TocNodeType.Leaf,
            page,
            startPos,
            endPos
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

  public toc() {
    return this.ensureLoaded(this._toc)
  }

  public title() {
    return this.ensureLoaded(this._title).v
  }

  public slug() {
    return this.ensureLoaded(this._slug).v
  }

  public pages() {
    return this.tocLeaves().map(l => l.page)
  }

  private tocLeaves() {
    const toc = this.toc()
    return I.List<TocLeaf>().withMutations(acc => this.collectPages(toc, acc))
  }

  private collectPages(nodes: TocNode[], acc: I.List<TocLeaf>) {
    nodes.forEach(n => {
      if (n.type === TocNodeType.Leaf) { acc.push(n) } else { this.collectPages(n.children, acc) }
    })
  }

  private collectNonPages(nodes: TocNode[], acc: I.List<TocInner>) {
    nodes.forEach(n => {
      if (n.type !== TocNodeType.Leaf) {
        acc.push(n)
        this.collectNonPages(n.children, acc)
      }
    })
  }

  public getValidationChecks(): ValidationCheck[] {
    const pages = this.pages()
    const nonPages = I.List<TocInner>().withMutations(acc => this.collectNonPages(this.toc(), acc))
    const duplicateTitles = I.Set(findDuplicates(nonPages.map(subcol => subcol.title)))
    const pageLeaves = I.List<TocLeaf>().withMutations(acc => this.collectPages(this.toc(), acc))
    const duplicatePages = I.Set(findDuplicates(pages))
    return [
      {
        message: 'Missing page',
        nodesToLoad: I.Set(pages),
        fn: () => I.Set(this.tocLeaves()).filter(p => !p.page.exists())
      },
      {
        message: 'Duplicate chapter title',
        nodesToLoad: I.Set(),
        fn: () => I.Set(nonPages.filter(subcol => duplicateTitles.has(subcol.title)))
      },
      {
        message: 'Duplicate page',
        nodesToLoad: I.Set(),
        fn: () => I.Set(pageLeaves.filter(p => duplicatePages.has(p.page)))
      }
    ]
  }
}
