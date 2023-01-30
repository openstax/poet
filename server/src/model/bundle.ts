import I from 'immutable'
import * as Quarx from 'quarx'
import { Bundleish, findDuplicates, Opt, PathHelper, PathKind, select, WithRange, calculateElementPositions, expectValue, NOWHERE, join } from './utils'
import { Factory } from './factory'
import { PageNode } from './page'
import { BookNode } from './book'
import { Fileish, ValidationCheck, ValidationKind } from './fileish'
import { ResourceNode } from './resource'
import fs from 'fs'

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

  public isDuplicate(property: string, nodes: I.Set<Fileish>, condition: any) {
    const duplicates = I.Set(findDuplicates(I.List(nodes).filter(n => n.exists).map(n => condition(n))))
    return duplicates.has(property)
  }

  public isDuplicateUuid(uuid: string) {
    return this.isDuplicate(uuid, this.allPages.all, (p: PageNode): string => { return p.uuid() })
  }

  public isDuplicateFilename(filename: string) {
    return this.isDuplicate(filename, this.allResources.all, (r: ResourceNode): string => { return r.absPath.toLowerCase() })
  }

  public unusedResources(nodes: I.Set<ResourceNode>) {
    const resources = fs.readdirSync(this.pathHelper.join(this.workspaceRootUri, 'media')).map(f => this.pathHelper.join(this.workspaceRootUri, 'media', f)).sort()
    const referencedResources = nodes.map(node => node.absPath)
    const unused = resources.filter(file => !referencedResources.includes(file))
    if (unused.length > 0) {
      console.error(`${unused.length} file(s) are unused`)
      return true
    }
    return false
  }

  public checkDuplicateResources() {
    const mediaFiles = fs.readdirSync(this.pathHelper.join(this.workspaceRootUri, 'media')).sort()
    const map = new Map<string, I.List<string>|undefined>()
    mediaFiles.forEach(filename => {
      const lowercaseFilename = filename.toLowerCase()
      if (map.has(lowercaseFilename)) {
        map.set(lowercaseFilename, map.get(lowercaseFilename)?.push(filename))
      } else {
        map.set(lowercaseFilename, I.List<string>([this.absPath]))
      }
    })
    let duplicates = false

    for (const [, values] of map) {
      if (values !== undefined && values.size > 1) {
        duplicates = true
        console.error(`${values.join(', ')} are duplicates`)
      }
    }
    return duplicates
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
      },
      {
        message: BundleValidationKind.DUPLICATE_RESOURCES,
        nodesToLoad: I.Set(),
        fn: () => this.checkDuplicateResources() ? I.Set([NOWHERE]) : I.Set()
      },
      {
        message: BundleValidationKind.UNUSED_RESOURCES,
        nodesToLoad: I.Set(),
        fn: () => this.unusedResources(this.allResources.all) ? I.Set([NOWHERE]) : I.Set()
      }
    ]
  }
}

export class BundleValidationKind extends ValidationKind {
  static MISSING_BOOK = new BundleValidationKind('Missing book')
  static NO_BOOKS = new BundleValidationKind('No books defined')
  static DUPLICATE_RESOURCES = new BundleValidationKind('Resources with same names found')
  static UNUSED_RESOURCES = new BundleValidationKind('Unused resources found')
}
