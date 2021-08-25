import I from 'immutable'
import { Bundleish, findDuplicates, Opt, PathHelper, PathKind, select, WithRange, calculateElementPositions, expectValue, NOWHERE } from './utils'
import { Factory } from './factory'
import { PageNode } from './page'
import { BookNode } from './book'
import { Fileish, ValidationCheck } from './fileish'
import { ImageNode } from './image'

export class Bundle extends Fileish implements Bundleish {
  public readonly allImages: Factory<ImageNode> = new Factory((absPath: string) => new ImageNode(this, this._pathHelper, absPath))
  public readonly allPages: Factory<PageNode> = new Factory((absPath: string) => new PageNode(this, this._pathHelper, absPath))
  public readonly allBooks = new Factory((absPath: string) => new BookNode(this, this._pathHelper, absPath))
  private _books: Opt<I.Set<WithRange<BookNode>>>

  constructor(pathHelper: PathHelper<string>, public readonly workspaceRoot: string) {
    super(undefined, pathHelper, pathHelper.join(workspaceRoot, 'META-INF/books.xml'))
    super.setBundle(this)
  }

  protected parseXML = (doc: Document) => {
    const bookNodes = select('//bk:book', doc) as Element[]
    this._books = I.Set(bookNodes.map(b => {
      const range = calculateElementPositions(b)
      const href = expectValue(b.getAttribute('href'), 'ERROR: Missing @href attribute on book element')
      const book = this.allBooks.getOrAdd(this.join(PathKind.ABS_TO_REL, this.absPath, href))
      return {
        v: book,
        range
      }
    }))
  }

  public get allNodes() {
    return I.Set([this]).union(this.allBooks.all).union(this.allPages.all).union(this.allImages.all)
  }

  public get books() {
    return this.__books().map(b => b.v)
  }

  private __books() {
    return this.ensureLoaded(this._books)
  }

  public isDuplicateUuid(uuid: string) {
    const pages = this.allPages.all
    const duplicateUuids = I.Set(findDuplicates(I.List(pages).filter(p => p.exists).map(p => p.uuid())))
    return duplicateUuids.has(uuid)
  }

  protected getValidationChecks(): ValidationCheck[] {
    const books = this.__books()
    return [
      {
        message: BundleValidationKind.MISSING_BOOK,
        nodesToLoad: this.books,
        fn: () => books.filter(b => !b.v.exists).map(b => b.range)
      },
      {
        message: BundleValidationKind.NO_BOOKS,
        nodesToLoad: I.Set(),
        fn: () => books.isEmpty() ? I.Set([NOWHERE]) : I.Set()
      }
    ]
  }
}

export enum BundleValidationKind {
  MISSING_BOOK = 'Missing book',
  NO_BOOKS = 'No books defined'
}
