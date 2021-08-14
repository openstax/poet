import I from 'immutable'
import { Bundleish, findDuplicates, NOWHERE_END, NOWHERE_START, Opt, PathHelper, PathType, select, WithSource, calculateElementPositions, expect } from './utils'
import { Factory } from './factory'
import { PageNode } from './page'
import { BookNode } from './book'
import { Fileish, ValidationCheck } from './fileish'
import { ImageNode } from './image'

export class Bundle extends Fileish implements Bundleish {
  public readonly allImages: Factory<ImageNode> = new Factory((absPath: string) => new ImageNode(this, this._pathHelper, absPath))
  public readonly allPages: Factory<PageNode> = new Factory((absPath: string) => new PageNode(this, this._pathHelper, absPath))
  public readonly allBooks = new Factory((absPath: string) => new BookNode(this, this._pathHelper, absPath))
  private _books: Opt<I.Set<WithSource<BookNode>>>

  constructor(pathHelper: PathHelper<string>, public readonly workspaceRoot: string) {
    super(undefined, pathHelper, pathHelper.join(workspaceRoot, 'META-INF/books.xml'))
    super.setBundle(this)
  }

  protected childrenToLoad = () => this.books()
  protected parseXML = (doc: Document) => {
    const bookNodes = select('//bk:book', doc) as Element[]
    this._books = I.Set(bookNodes.map(b => {
      const [startPos, endPos] = calculateElementPositions(b)
      const href = expect(b.getAttribute('href'), 'ERROR: Missing @href attribute on book element')
      const book = this.allBooks.get(this.join(PathType.ABS_TO_REL, this.absPath, href))
      return {
        v: book,
        startPos,
        endPos
      }
    }))
  }

  public allNodes() {
    return I.Set([this]).union(this.allBooks.all()).union(this.allPages.all()).union(this.allImages.all())
  }

  public books() {
    return this.__books().map(b => b.v)
  }

  private __books() {
    return this.ensureLoaded(this._books)
  }

  private gc() {
    // Remove any objects that don't exist and are not pointed to by a book
    // This may need to run every time an object is deleted (or exists is set to false)
  }

  public getValidationChecks(): ValidationCheck[] {
    const books = this.__books()
    return [
      {
        message: 'Missing book',
        nodesToLoad: this.books(),
        fn: () => books.filter(b => !b.v.exists())
      },
      {
        message: 'No books are defiend',
        nodesToLoad: I.Set(),
        fn: () => books.isEmpty() ? I.Set([{ startPos: NOWHERE_START, endPos: NOWHERE_END }]) : I.Set()
      }
    ]
  }

  public isDuplicateUuid(uuid: string) {
    const pages = this.allPages.all()
    const duplicateUuids = I.Set(findDuplicates(I.List(pages).filter(p => p.exists()).map(p => p.uuid())))
    return duplicateUuids.has(uuid)
  }
}
