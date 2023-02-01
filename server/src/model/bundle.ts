import I from 'immutable'
import * as Quarx from 'quarx'
import { Bundleish, findDuplicates, Opt, PathHelper, PathKind, select, WithRange, calculateElementPositions, expectValue, NOWHERE, join, formatString } from './utils'
import { Factory } from './factory'
import { PageNode } from './page'
import { BookNode } from './book'
import { Fileish, ModelError, ValidationCheck, ValidationKind, ValidationSeverity } from './fileish'
import { ResourceNode } from './resource'
import fs from 'fs'
import path from 'path'
import { URI } from 'vscode-uri'

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

  public directoryWalkThrough(folderPaths: string[], files: string[]) {
    Fileish.debug(folderPaths)
    // this method takes a set of folders and recursively list the file children of the different folders
    folderPaths.filter(folderPath => fs.existsSync(folderPath)).forEach(folderPath => {
      fs.readdirSync(folderPath).forEach(file => {
        const absolutePath = path.join(folderPath, file)
        if (fs.statSync(absolutePath).isDirectory()) return this.directoryWalkThrough([absolutePath], files)
        else return files.push(absolutePath)
      })
    })
    return files
  }

  public checkDuplicateResources(): I.Set<ModelError> {
    // This method list the files in a set of directories and sort them. If two subsequent filenames have the same name in lowercase then they are duplicates.
    const x = URI.parse(this.workspaceRootUri)
    const paths = [path.join(x.fsPath, 'media')]
    const mediaFiles = this.directoryWalkThrough(paths, []).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    const duplicates = I.Set<string>()
    if (mediaFiles.length > 1) {
      for (let index = 1; index < mediaFiles.length; index++) {
        if (mediaFiles[index].toLowerCase() === mediaFiles[index - 1].toLowerCase()) {
          Fileish.debug(`${mediaFiles[index]} and ${mediaFiles[index - 1]} are duplicates`)
          duplicates.add(mediaFiles[index])
          duplicates.add(mediaFiles[index - 1])
        }
      }
    }
    if (duplicates.size === 0) return I.Set<ModelError>()
    else return I.Set([new ModelError(this, formatString('{0} have similar names.', duplicates.join(' ,')), ValidationSeverity.ERROR, NOWHERE)])
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
        fn: () => this.checkDuplicateResources()
      }
    ]
  }
}

export class BundleValidationKind extends ValidationKind {
  static MISSING_BOOK = new BundleValidationKind('Missing book')
  static NO_BOOKS = new BundleValidationKind('No books defined')
  static DUPLICATE_RESOURCES = new BundleValidationKind('{0} have similar names.')
}
