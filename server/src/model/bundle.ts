import I from 'immutable'
import * as Quarx from 'quarx'
import { Bundleish, findDuplicates, Opt, PathHelper, PathKind, select, WithRange, calculateElementPositions, expectValue, NOWHERE, join } from './utils'
import { Factory } from './factory'
import { PageNode } from './page'
import { BookNode } from './book'
import { Fileish, ValidationCheck } from './fileish'
import { ResourceNode } from './resource'

export class Bundle extends Fileish implements Bundleish {
  public readonly allResources: Factory<ResourceNode> = new Factory((absPath: string) => new ResourceNode(this, this.pathHelper, absPath), (x) => this.pathHelper.canonicalize(x))
  public readonly allPages: Factory<PageNode> = new Factory((absPath: string) => new PageNode(this, this.pathHelper, absPath), (x) => this.pathHelper.canonicalize(x))
  public readonly allBooks = new Factory((absPath: string) => new BookNode(this, this.pathHelper, absPath), (x) => this.pathHelper.canonicalize(x))
  private readonly _books = Quarx.observable.box<Opt<I.Set<WithRange<BookNode>>>>(undefined)

  constructor(pathHelper: PathHelper<string>, public readonly workspaceRootUri: string) {
    super(undefined, pathHelper, pathHelper.join(workspaceRootUri, 'META-INF/books.xml'))
    super.setBundle(this)
  }

  protected parseXML = (doc: Document) => {
    const bookNodes = select('//bk:book', doc) as Element[]
    this._books.set(I.Set(bookNodes.map(b => {
      const range = calculateElementPositions(b)
      const href = expectValue(b.getAttribute('href'), 'ERROR: Missing @href attribute on book element')
      const book = this.allBooks.getOrAdd(join(this.pathHelper, PathKind.ABS_TO_REL, this.absPath, href))
      return {
        v: book,
        range
      }
    })))
  }

  public get allNodes() {
    return I.Set([this]).union(this.allBooks.all).union(this.allPages.all).union(this.allResources.all)
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
