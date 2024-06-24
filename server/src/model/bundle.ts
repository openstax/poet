import I from 'immutable'
import * as Quarx from 'quarx'
import { type Bundleish, findDuplicates, type Opt, type PathHelper, PathKind, select, type WithRange, calculateElementPositions, expectValue, NOWHERE, join } from './utils'
import { Factory } from './factory'
import { PageNode } from './page'
import { BookNode } from './book'
import { Fileish, type ValidationCheck, ValidationKind } from './fileish'
import { ResourceNode } from './resource'
import { H5PExercise } from './h5p-exercise'

export class Bundle extends Fileish implements Bundleish {
  public readonly allResources: Factory<ResourceNode> = new Factory<ResourceNode>((absPath: string) => new ResourceNode(this, this.pathHelper, absPath), (x) => this.pathHelper.canonicalize(x))
  public readonly allPages: Factory<PageNode> = new Factory<PageNode>((absPath: string) => new PageNode(this, this.pathHelper, absPath), (x) => this.pathHelper.canonicalize(x))
  public readonly allH5P: Factory<H5PExercise> = new Factory<H5PExercise>((absPath: string) => new H5PExercise(this, this.pathHelper, absPath), (x) => this.pathHelper.canonicalize(x))
  public readonly allBooks = new Factory((absPath: string) => new BookNode(this, this.pathHelper, absPath), (x) => this.pathHelper.canonicalize(x))
  private readonly _books = Quarx.observable.box<Opt<I.Set<WithRange<BookNode>>>>(undefined)
  private readonly _booksXMLBooks = Quarx.observable.box<Opt<I.Set<WithRange<BooksXMLBook>>>>(undefined)
  private readonly _duplicateFilePaths = Quarx.observable.box<I.Set<string>>(I.Set<string>())
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
      this._duplicateFilePaths.set(
        I.Set(
          findDuplicates(
            I.List(this.allNodes)
              .filter(n => n.exists)
              .map(n => n.absPath.toLowerCase())
          )
        )
      )
    })
    Quarx.autorun(() => {
      this._duplicateUUIDs.set(
        I.Set(
          findDuplicates(
            I.List(this.allPages.all).filter(n => n.exists).map(n => n.uuid())
          )
        )
      )
    })
  }

  protected parseXML = (doc: Document) => {
    const bookNodes = select('//bk:book', doc) as Element[]
    const booksXMLBooks = I.Set(bookNodes.map((b => {
      const range = calculateElementPositions(b)
      const href = expectValue(b.getAttribute('href'), 'ERROR: Missing @href attribute on book element')
      const slug = expectValue(b.getAttribute('slug'), 'ERROR: Missing @slug attribute on book element')
      const v: BooksXMLBook = { slug, href }
      return { v, range }
    })))
    this._booksXMLBooks.set(booksXMLBooks)
    this._books.set(I.Set(booksXMLBooks.map(b => {
      const range = b.range
      const href = b.v.href
      const book = this.allBooks.getOrAdd(join(this.pathHelper, PathKind.ABS_TO_REL, this.absPath, href))
      return {
        v: book,
        range
      }
    })))
  }

  public get allNodes() {
    // TODO: Will all nodes continue to be fileish in future?
    return I.Set([this])
      .union(this.allBooks.all)
      .union(this.allPages.all)
      .union(this.allH5P.all)
      .union(this.allResources.all)
  }

  public get books() {
    return this.__books().map(b => b.v)
  }

  public isDuplicateFilePath(path: string): boolean {
    return this._duplicateFilePaths.get().has(path.toLowerCase())
  }

  private __books() {
    return this.ensureLoaded(this._books)
  }

  public isDuplicateUuid(uuid: string) {
    return this._duplicateUUIDs.get().has(uuid)
  }

  protected getValidationChecks(): ValidationCheck[] {
    const books = this.__books()
    const booksXMLBooks = this.ensureLoaded(this._booksXMLBooks)
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
      },
      {
        message: BundleValidationKind.MISMATCHED_SLUG,
        nodesToLoad: this.books,
        fn: () => booksXMLBooks
          .filter(
            ({ v: bx }) => books.filter(
              ({ v: b }) => b.isValidXML && b.exists && b.slug === bx.slug
            ).size === 0
          )
          .map(bx => bx.range)
      }
    ]
  }
}

export class BundleValidationKind extends ValidationKind {
  static MISMATCHED_SLUG = new BundleValidationKind('Slug does not match any defined in a book')
  static MISSING_BOOK = new BundleValidationKind('Missing book')
  static NO_BOOKS = new BundleValidationKind('No books defined')
}

interface BooksXMLBook {
  slug: string
  href: string
}
