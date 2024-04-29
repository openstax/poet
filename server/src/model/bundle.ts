import I from 'immutable'
import * as Quarx from 'quarx'
import { type Bundleish, findDuplicates, type Opt, type PathHelper, PathKind, select, type WithRange, calculateElementPositions, expectValue, NOWHERE, join } from './utils'
import { Factory } from './factory'
import { PageNode } from './page'
import { BookNode } from './book'
import { Fileish, type ValidationCheck, ValidationKind } from './fileish'
import { ResourceNode } from './resource'

export class Bundle extends Fileish implements Bundleish {
  public readonly allResources: Factory<ResourceNode> = new Factory<ResourceNode>((absPath: string) => new ResourceNode(this, this.pathHelper, absPath), (x) => this.pathHelper.canonicalize(x))
  public readonly allPages: Factory<PageNode> = new Factory<PageNode>((absPath: string) => new PageNode(this, this.pathHelper, absPath), (x) => this.pathHelper.canonicalize(x))
  public readonly allBooks = new Factory((absPath: string) => new BookNode(this, this.pathHelper, absPath), (x) => this.pathHelper.canonicalize(x))
  private readonly _books = Quarx.observable.box<Opt<I.Set<WithRange<BookNode>>>>(undefined)
  private readonly _duplicateResourcePaths = Quarx.observable.box<I.Set<string>>(I.Set<string>())
  private readonly _duplicateUUIDs = Quarx.observable.box<I.Set<string>>(I.Set<string>())
  // TODO: parse these from META-INF/books.xml
  public readonly paths = {
    publicRoot: 'interactives',
    privateRoot: 'private',
    booksRoot: 'collections',
    pagesRoot: 'modules',
    mediaRoot: 'media'
  }

  constructor(pathHelper: PathHelper<string>, public readonly workspaceRootUri: string) {
    super(undefined, pathHelper, pathHelper.join(workspaceRootUri, 'META-INF/books.xml'))
    super.setBundle(this)
    Quarx.autorun(() => {
      this._duplicateResourcePaths.set(
        I.Set(
          findDuplicates(I.List(this.allResources.all)
            .map(n => n.absPath.toLowerCase())
          )
        )
      )
    })
    Quarx.autorun(() => {
      this._duplicateUUIDs.set(
        I.Set(
          findDuplicates(I.List(this.allPages.all)
            .filter(n => n.exists)
            .map(n => n.uuid())
          )
        )
      )
    })
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

  public isDuplicateResourcePath(path: string): boolean {
    return this._duplicateResourcePaths.get().has(path.toLowerCase())
  }

  private __books() {
    return this.ensureLoaded(this._books)
  }

  public isDuplicateUuid(uuid: string) {
    return this._duplicateUUIDs.get().has(uuid)
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

export class BundleValidationKind extends ValidationKind {
  static MISSING_BOOK = new BundleValidationKind('Missing book')
  static NO_BOOKS = new BundleValidationKind('No books defined')
}
