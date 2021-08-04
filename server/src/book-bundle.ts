import { DOMParser } from 'xmldom'
import path from 'path'
import fs from 'fs'
import { FileChangeType, FileEvent, Position } from 'vscode-languageserver/node'
import * as xpath from 'xpath-ts'
import Immutable from 'immutable'
import * as Quarx from 'quarx'
import { calculateElementPositions, expect, fileExistsAt, fileExistsAtSync, getOrAdd, profile } from './utils'
import { TocTreeModule, TocTreeCollection, TocTreeElement, TocTreeElementType } from '../../common/src/toc-tree'
import {
  URI
} from 'vscode-uri'

export const NS_COLLECTION = 'http://cnx.rice.edu/collxml'
export const NS_CNXML = 'http://cnx.rice.edu/cnxml'
export const NS_METADATA = 'http://cnx.rice.edu/mdml'

const FS_SEP = path.sep

const select = xpath.useNamespaces({ cnxml: NS_CNXML, col: NS_COLLECTION, md: NS_METADATA })

export interface Link {
  moduleid: string
  targetid: string | null
  element: any
}

export interface FileData { data: string }

export interface ModuleTitle { title: string, moduleid: string }

export interface ImageSource {
  name: string
  path: string
  startPos: Position
  endPos: Position
  inBundleMedia: boolean
  exists: boolean
}

interface ImageWithPosition {
  relPath: string
  startPos: Position
  endPos: Position
}

export interface ModuleLink {
  moduleid: string
  element: any
}

export type BundleItemType = 'collections' | 'modules' | 'media'
const isBundleItemType = (value: string): value is BundleItemType => {
  return value === 'collections' || value === 'modules' || value === 'media'
}

export interface BundleItem {
  type: BundleItemType
  key: string
}

class ModuleInfo {
  private _isLoaded = false
  private readonly _idsDeclared = Quarx.observable.box(Immutable.Map<string, number>())
  private readonly _imagesUsed = Quarx.observable.box(Immutable.Set<ImageWithPosition>())
  private readonly _linksDeclared = Quarx.observable.box(Immutable.Set<Link>())
  private readonly _titleFromDocument = Quarx.observable.box<string|null>(null)

  constructor(private readonly bundle: BookBundle, readonly moduleid: string) {}

  static pathToFile(workspaceRoot: string, moduleid: string) {
    return path.join(workspaceRoot, 'modules', moduleid, 'index.cnxml')
  }
  private _readFileSync(): string {
    const p = ModuleInfo.pathToFile(this.bundle.workspaceRoot(), this.moduleid)
    return fs.readFileSync(p, { encoding: 'utf-8' })
  }

  refresh(): void {
    const xml = this._readFileSync()
    this._isLoaded = true
    if (xml === '') return
    const doc = new DOMParser().parseFromString(xml)
    this._idsDeclared.set(this.__idsDeclared(doc))
    this._imagesUsed.set(this.__imagesUsed(doc)) // need to path.basename(x) and unwrapso .imagesUsed() only returns strings
    this._linksDeclared.set(this.__linksDeclared(doc))
    this._titleFromDocument.set(this.__titleFromDocument(doc))
  }

  idsDeclared(): Immutable.Map<string, number> {
    this._expectLoaded()
    return this._idsDeclared.get()
  }

  linksDeclared(): Immutable.Set<Link> {
    this._expectLoaded()
    return this._linksDeclared.get()
  }

  imagesUsed(): Immutable.Set<ImageWithPosition> {
    this._expectLoaded()
    return this._imagesUsed.get()
  }

  imageSources(bundleMedia: Immutable.Set<string>): Immutable.Set<ImageSource> {
    this._expectLoaded()
    return this._imagesUsed.get().map(img => {
      const basename = path.basename(img.relPath)
      // Assume this module is found in /modules/*/index.cnxml and image src is a relative path
      const mediaSourceResolved = path.resolve(this.bundle.moduleDirectory(), this.moduleid, img.relPath)
      const inBundleMedia = bundleMedia.has(basename) && path.dirname(mediaSourceResolved) === this.bundle.mediaDirectory()
      return {
        name: basename,
        path: img.relPath,
        inBundleMedia,
        exists: inBundleMedia || (img.relPath !== '' && fileExistsAtSync(mediaSourceResolved)),
        startPos: img.startPos,
        endPos: img.endPos
      }
    })
  }

  title(): ModuleTitle {
    if (this._titleFromDocument.get() === null) {
      const fileData = this._readFileSync()
      const guessedTitle = this._guessFromFileData(fileData)
      if (guessedTitle != null) {
        this._titleFromDocument.set(guessedTitle.title)
        return guessedTitle
      }
    }
    this.refresh()
    return this._moduleTitleFromString(this._titleFromDocument.get() ?? '')
  }

  private _expectLoaded(): void {
    expect(this._isLoaded || null, 'This Object has not been loaded yet. Be sure to call .refresh() first')
  }

  private __idsDeclared(doc: Document): Immutable.Map<string, number> {
    const idNodes = select('//cnxml:*[@id]', doc) as Element[]
    return Immutable.Map<string, number>().withMutations(map => {
      for (const idNode of idNodes) {
        const id = expect(idNode.getAttribute('id'), 'selection requires attribute exists')
        const existing = map.get(id) ?? 0
        map.set(id, existing + 1)
      }
    })
  }

  private __imagesUsed(doc: Document): Immutable.Set<ImageWithPosition> {
    const imageNodes = select('//cnxml:image[@src]', doc) as Element[]
    return Immutable.Set<ImageWithPosition>().withMutations(s => {
      for (const imageNode of imageNodes) {
        const relPath = expect(imageNode.getAttribute('src'), 'selection requires attribute exists')
        const [startPos, endPos] = calculateElementPositions(imageNode)
        s.add({
          relPath,
          startPos,
          endPos
        })
      }
    })
  }

  private __linksDeclared(doc: Document): Immutable.Set<Link> {
    const linkNodes = select('//cnxml:link', doc) as Element[]
    return Immutable.Set<Link>().withMutations(s => {
      for (const linkNode of linkNodes) {
        const toDocument = linkNode.hasAttribute('document')
        const toTargetId = linkNode.hasAttribute('target-id')
        if (toTargetId && !toDocument) {
          s.add({
            moduleid: this.moduleid,
            targetid: expect(linkNode.getAttribute('target-id'), 'logic requires attribute exists'),
            element: linkNode
          })
        } else if (toDocument && !toTargetId) {
          s.add({
            moduleid: expect(linkNode.getAttribute('document'), 'logic requires attribute exists'),
            targetid: null,
            element: linkNode
          })
        } else if (toDocument && toTargetId) {
          s.add({
            moduleid: expect(linkNode.getAttribute('document'), 'logic requires attribute exists'),
            targetid: expect(linkNode.getAttribute('target-id'), 'logic requires attribute exists'),
            element: linkNode
          })
        }
      }
    })
  }

  private __titleFromDocument(doc: Document): string {
    const titleNode = select('//cnxml:title', doc) as Element[]
    if (titleNode.length > 0) {
      return titleNode[0].textContent ?? ''
    }
    return 'Unnamed Module'
  }

  private _moduleTitleFromString(titleString: string): ModuleTitle {
    return { title: titleString, moduleid: this.moduleid }
  }

  private _guessFromFileData(data: string): ModuleTitle | null {
    const titleTagStart = data.indexOf('<title>')
    const titleTagEnd = data.indexOf('</title>')
    if (titleTagStart === -1 || titleTagEnd === -1) {
      return null
    }
    const actualTitleStart = titleTagStart + 7 // Add length of '<title>'
    if (titleTagEnd - actualTitleStart > 280) {
      // If the title is so long you can't tweet it,
      // then something probably went wrong.
      /* istanbul ignore next */
      return null
    }
    const moduleTitle = data.substring(actualTitleStart, titleTagEnd).trim()
    return this._moduleTitleFromString(moduleTitle)
  }
}

class CollectionInfo {
  private _isLoaded = false
  private readonly _modulesUsed = Quarx.observable.box(Immutable.Set<ModuleLink>())
  // UGH, Store document in memory because some code relies on thrown exceptions to send diagnostics
  // that the collection.xml file is invalid.
  // So, we cache the DOM but delay actually parsing the fields (like title, uuid, slug, etc) until later.
  // TODO: Maybe there is a better way.
  private readonly _doc = Quarx.observable.box(new DOMParser().parseFromString('<unparsed-file-yet/>'))

  constructor(private readonly bundle: BookBundle, readonly filename: string) {}

  private _readFileSync(): string {
    const modulePath = path.join(this.bundle.workspaceRoot(), 'collections', this.filename)
    return fs.readFileSync(modulePath, { encoding: 'utf-8' })
  }

  public refresh(): void {
    const xml = this._readFileSync()
    this._isLoaded = true
    if (xml === '') return
    const doc = new DOMParser().parseFromString(xml)
    this._modulesUsed.set(this.__modulesUsed(doc))
    this._doc.set(doc)
  }

  private _expectLoaded(): void {
    expect(this._isLoaded || null, 'This Object has not been loaded yet. Be sure to call .refresh() first')
  }

  modulesUsed(): Immutable.Set<ModuleLink> {
    this._expectLoaded()
    return this._modulesUsed.get()
  }

  private __modulesUsed(doc: Document): Immutable.Set<ModuleLink> {
    const moduleNodes = select('//col:module', doc) as Element[]
    return Immutable.Set<ModuleLink>().withMutations(s => {
      for (const moduleNode of moduleNodes) {
        const moduleid = moduleNode.getAttribute('document') ?? ''
        s.add({
          element: moduleNode,
          moduleid: moduleid
        })
      }
    })
  }

  tree(): TocTreeCollection {
    this._expectLoaded()
    return this._tree(this._doc.get())
  }

  private _tree(doc: Document): TocTreeCollection {
    const modulesUsed = this._modulesUsed.get()
    const moduleTitles = modulesUsed.map(moduleLink => this.bundle.moduleTitle(moduleLink.moduleid))
    const moduleTitlesDefined = moduleTitles.toArray().filter(t => t != null) as ModuleTitle[]
    return this.__tree(doc, moduleTitlesDefined)
  }

  private __tree(doc: Document, titles: ModuleTitle[]): TocTreeCollection {
    const moduleTitleMap = new Map<string, string>()
    for (const entry of titles) {
      moduleTitleMap.set(entry.moduleid, entry.title)
    }
    const moduleToObjectResolver = (moduleid: string): TocTreeModule => {
      return {
        type: TocTreeElementType.module,
        moduleid: moduleid,
        title: moduleTitleMap.get(moduleid) ?? '**DOES NOT EXIST**',
        subtitle: moduleid
      }
    }
    const tree = parseCollection(doc, moduleToObjectResolver)
    return tree
  }
}

function readdirSync(filePath: string): string[] {
  try { // dir may not exist
    return fs.readdirSync(filePath)
  } catch (e) { }
  return []
}

export class BookBundle {
  private _isLoaded = false
  constructor(
    readonly _workspaceRoot: string,
    private readonly _images: Quarx.Box<Immutable.Set<string>>,
    private readonly _modules: Quarx.Box<Immutable.Map<string, ModuleInfo>>,
    private readonly _collections: Quarx.Box<Immutable.Map<string, CollectionInfo>>
  ) {}

  // Logging
  static error = console.error
  static debug(...args: any[]) { if (process.env['NODE_ENV'] !== 'production') { console.debug(...args) } }
  
  static async from(workspaceRoot: string): Promise<BookBundle> {
    const images = Quarx.observable.box(Immutable.Set<string>())
    const modules = Quarx.observable.box(Immutable.Map<string, ModuleInfo>())
    const collections = Quarx.observable.box(Immutable.Map<string, CollectionInfo>())
    const bundle = new BookBundle(workspaceRoot, images, modules, collections)
    const loadImages = (): void => {
      if (bundle._isLoaded) { BookBundle.debug('autorun rerunning loadImages') }
      const foundImages = readdirSync(bundle.mediaDirectory())
      images.set(Immutable.Set<string>().withMutations(s => {
        for (const image of foundImages) {
          s.add(image)
        }
      }))
    }
    const loadModules = (): void => {
      if (bundle._isLoaded) { BookBundle.debug('autorun rerunning loadModules') }
      const foundPossibleModules = readdirSync(bundle.moduleDirectory())
      const moduleCnxmlExists = foundPossibleModules.map(
        (moduleId) => (path.join(bundle.moduleDirectory(), moduleId, 'index.cnxml'))
      ).map(fileExistsAt)
      const foundModules = foundPossibleModules.filter((_, indx) => moduleCnxmlExists[indx])
      modules.set(Immutable.Map<string, ModuleInfo>().withMutations(m => {
        for (const module of foundModules) {
          // TODO: We seem to be ok with missing module files. Why????
          const file = ModuleInfo.pathToFile(bundle.workspaceRoot(), module)
          if (fileExistsAtSync(file)) {
            m.set(module, new ModuleInfo(bundle, module))
          } else {
            BookBundle.debug('Warn: Could not find module file. Why not fail at this point?', file)
          }
        }
      }))
    }
    const loadCollections = (): void => {
      if (bundle._isLoaded) { BookBundle.debug('autorun rerunning loadCollections') }
      const foundCollections = readdirSync(bundle.collectionDirectory())
      collections.set(Immutable.Map<string, CollectionInfo>().withMutations(m => {
        for (const collection of foundCollections) {
          m.set(collection, new CollectionInfo(bundle, collection))
        }
      }))
    }
    const ms = profile(() => {
      Quarx.autorun(loadImages)
      Quarx.autorun(loadModules)
      Quarx.autorun(loadCollections)
      bundle.refresh()
    })
    Quarx.untracked(() => 
      BookBundle.debug(`Loaded ${bundle._images.get().size} images, ${bundle._modules.get().size} modules, and ${bundle._collections.get().size} collections in ${ms} ms`)
    )
    bundle._isLoaded = true
    return bundle
  }

  workspaceRoot(): string {
    return this._workspaceRoot
  }

  mediaDirectory(): string {
    return path.resolve(this.workspaceRoot(), 'media')
  }

  moduleDirectory(): string {
    return path.resolve(this.workspaceRoot(), 'modules')
  }

  collectionDirectory(): string {
    return path.resolve(this.workspaceRoot(), 'collections')
  }

  images(): string[] {
    return Array.from(this._images.get().values())
  }

  modules(): string[] {
    return Array.from(this._modules.get().keys())
  }

  moduleItems(): BundleItem[] {
    return Array.from(this._modules.get().keys()).map(key => ({ type: 'modules', key: key }))
  }

  collections(): string[] {
    return Array.from(this._collections.get().keys())
  }

  collectionItems(): BundleItem[] {
    return Array.from(this._collections.get().keys()).map(key => ({ type: 'collections', key: key }))
  }

  imageExists(name: string): boolean {
    return this._images.get().has(name)
  }

  moduleExists(moduleid: string): boolean {
    return this._modules.get().has(moduleid)
  }

  collectionExists(filename: string): boolean {
    return this._collections.get().has(filename)
  }

  refresh(): void {
    [...this._collections.get().values()].forEach(c => c.refresh())
    ;[...this._modules.get().values()].forEach(c => c.refresh())
  }

  containsBundleItem(item: BundleItem): boolean {
    const existsFunc = {
      collections: this.collectionExists,
      modules: this.moduleExists,
      media: this.imageExists
    }[item.type].bind(this)
    return existsFunc(item.key)
  }

  bundleItemFromUri(uri: string): BundleItem | null {
    const itemPath = URI.parse(uri).fsPath
    const itemPathRelative = itemPath.replace(`${this.workspaceRoot()}${FS_SEP}`, '')
    const indexOfFirstSep = itemPathRelative.indexOf(FS_SEP)
    const itemType = itemPathRelative.substring(0, indexOfFirstSep)
    if (!isBundleItemType(itemType)) {
      // given uri is probably not in this workspace
      return null
    }
    if (itemType === 'modules') {
      if (!itemPathRelative.endsWith(`${FS_SEP}index.cnxml`)) {
        // Directory or some irrelevant file was edited
        return null
      }
      const indexOfSecondSep = itemPathRelative.indexOf(FS_SEP, indexOfFirstSep + 1)
      const moduleid = itemPathRelative.substring(indexOfFirstSep + 1, indexOfSecondSep)
      return {
        type: itemType,
        key: moduleid
      }
    }
    return {
      type: itemType,
      key: itemPathRelative.substring(indexOfFirstSep + 1)
    }
  }

  bundleItemToUri(item: BundleItem): string | null {
    if (!this.containsBundleItem(item)) {
      return null
    }
    if (item.type === 'modules') {
      return URI.from({
        scheme: 'file',
        path: path.join(this.workspaceRoot(), item.type, item.key, 'index.cnxml')
      }).toString()
    }
    return URI.from({
      scheme: 'file',
      path: path.join(this.workspaceRoot(), item.type, item.key)
    }).toString()
  }

  orphanedImages(): Immutable.Set<string> {
    const usedImagesPerModule = Array.from(this._modules.get().values()).map(module => module.imagesUsed())
    return this._orphanedImages(this._images.get(), usedImagesPerModule)
  }

  private _orphanedImages(allImages: Immutable.Set<string>, usedImagesPerModule: Array<Immutable.Set<ImageWithPosition>>): Immutable.Set<string> {
    return allImages.withMutations(s => {
      for (const moduleImages of usedImagesPerModule) {
        for (const image of moduleImages) {
          s.delete(path.basename(image.relPath))
        }
      }
    })
  }

  orphanedModules(): Immutable.Set<string> {
    const usedModulesPerCollection = Array.from(this._collections.get().values()).map(collection => collection.modulesUsed())
    return this._orphanedModules(this._modules.get(), usedModulesPerCollection)
  }

  private _orphanedModules(allModules: Immutable.Map<string, ModuleInfo>, usedModulesPerCollection: Array<Immutable.Set<ModuleLink>>): Immutable.Set<string> {
    return Immutable.Set(allModules.keys()).withMutations(s => {
      for (const collectionModules of usedModulesPerCollection) {
        for (const moduleLink of collectionModules) {
          s.delete(moduleLink.moduleid)
        }
      }
    })
  }

  modulesUsed(filename: string): Immutable.Set<ModuleLink> | null {
    const collectionInfo = this._collections.get().get(filename)
    if (collectionInfo == null) {
      return null
    }
    return collectionInfo.modulesUsed()
  }

  moduleTitle(moduleid: string): ModuleTitle | null {
    const moduleInfo = this._modules.get().get(moduleid)
    if (moduleInfo == null) {
      return null
    }
    return moduleInfo.title()
  }

  isIdInModule(id: string, moduleid: string): boolean {
    const moduleInfo = this._modules.get().get(moduleid)
    if (moduleInfo == null) {
      return false
    }
    return (moduleInfo.idsDeclared()).has(id)
  }

  isIdUniqueInModule(id: string, moduleid: string): boolean {
    const moduleInfo = this._modules.get().get(moduleid)
    if (moduleInfo == null) {
      return false
    }
    const elements = (moduleInfo.idsDeclared()).get(id)
    if (elements === 0) {
      return false
    }
    return elements === 1
  }

  moduleLinks(moduleid: string): Immutable.Set<Link> | null {
    const moduleInfo = this._modules.get().get(moduleid)
    if (moduleInfo == null) {
      return null
    }
    return moduleInfo.linksDeclared()
  }

  moduleIds(moduleid: string): Immutable.Set<string> | null {
    const moduleInfo = this._modules.get().get(moduleid)
    if (moduleInfo == null) {
      return null
    }
    return Immutable.Set((moduleInfo.idsDeclared()).keys())
  }

  moduleImageSources(moduleid: string): Immutable.Set<ImageSource> | null {
    const moduleInfo = this._modules.get().get(moduleid)
    if (moduleInfo == null) {
      return null
    }
    return moduleInfo.imageSources(this._images.get())
  }

  _moduleImageFilenames(moduleid: string): Immutable.Set<string> | null {
    const moduleInfo = this._modules.get().get(moduleid)
    if (moduleInfo == null) {
      return null
    }
    return (moduleInfo.imagesUsed()).map(i => path.basename(i.relPath))
  }

  collectionTree(filename: string): TocTreeCollection | null {
    const collectionInfo = this._collections.get().get(filename)
    if (collectionInfo == null) {
      return null
    }
    return collectionInfo.tree()
  }

  moduleAsTreeObject(moduleid: string): TocTreeModule {
    const title = this.moduleTitle(moduleid)
    return {
      type: TocTreeElementType.module,
      moduleid: moduleid,
      title: title?.title ?? 'Unnamed Module',
      subtitle: moduleid
    }
  }

  private onModuleCreated(moduleid: string): void {
    getOrAdd(this._modules, moduleid, () => new ModuleInfo(this, moduleid)).refresh()
  }

  private onModuleChanged(moduleid: string): void {
    getOrAdd(this._modules, moduleid, () => new ModuleInfo(this, moduleid)).refresh()
  }

  private onModuleDeleted(moduleid: string): void {
    this._modules.set(this._modules.get().delete(moduleid))
  }

  private onImageCreated(name: string): void {
    this._images.set(this._images.get().add(name))
  }

  private onImageChanged(name: string): void {
  }
  private onImageDeleted(name: string): void {
    this._images.set(this._images.get().delete(name))
  }

  private onCollectionCreated(filename: string): void {
    getOrAdd(this._collections, filename, () => new CollectionInfo(this, filename)).refresh()
  }

  private onCollectionChanged(filename: string): void {
    getOrAdd(this._collections, filename, () => new CollectionInfo(this, filename)).refresh()
  }

  private onCollectionDeleted(filename: string): void {
    this._collections.set(this._collections.get().delete(filename))
  }

  processChange(change: FileEvent): void {
    if (this.isDirectoryDeletion(change)) {
      // Special casing directory deletion processing since while these might
      // be rare / unexpected, the file watcher events don't necessarily notify
      // us of every impacted file. Hopefully this gets addressed by the underlying
      // file watcher implementation in the future and we can remove this
      // codepath altogether.
      this.processDirectoryDeletion(change)
      return
    }
    const item = this.bundleItemFromUri(change.uri)
    if (item == null) {
      return
    }
    const func = {
      collections: {
        [FileChangeType.Created]: this.onCollectionCreated,
        [FileChangeType.Changed]: this.onCollectionChanged,
        [FileChangeType.Deleted]: this.onCollectionDeleted
      },
      modules: {
        [FileChangeType.Created]: this.onModuleCreated,
        [FileChangeType.Changed]: this.onModuleChanged,
        [FileChangeType.Deleted]: this.onModuleDeleted
      },
      media: {
        [FileChangeType.Created]: this.onImageCreated,
        [FileChangeType.Changed]: this.onImageChanged,
        [FileChangeType.Deleted]: this.onImageDeleted
      }
    }[item.type][change.type].bind(this)
    BookBundle.debug('Filesystem updated. Running', func.name)
    func(item.key)
  }

  isDirectoryDeletion(change: FileEvent): boolean {
    if (change.type !== FileChangeType.Deleted) {
      return false
    }
    const deletedPath = URI.parse(change.uri).fsPath

    // This assumes both collections and media dirs are flat
    if ((deletedPath === this.collectionDirectory()) || (deletedPath === this.mediaDirectory())) {
      return true
    }

    const indexOfLastSep = deletedPath.lastIndexOf(FS_SEP)
    const maybeModuleId = deletedPath.substring(indexOfLastSep + 1)
    return ((deletedPath === this.moduleDirectory()) ||
            (deletedPath.includes(this.moduleDirectory()) && this.moduleExists(maybeModuleId)))
  }

  processDirectoryDeletion(change: FileEvent): void {
    const deletedPath = URI.parse(change.uri).fsPath

    if (deletedPath === this.collectionDirectory()) {
      Quarx.batch(() => this.collections().forEach((col) => { this.onCollectionDeleted(col) }))
      return
    }

    if (deletedPath === this.mediaDirectory()) {
      Quarx.batch(() => this.images().forEach((img) => { this.onImageDeleted(img) }))
      return
    }

    // Process a module directory deletion which could be either the parent or
    // a specific module
    if (deletedPath === this.moduleDirectory()) {
      Quarx.batch(() => this.modules().forEach((module) => { this.onModuleDeleted(module) }))
      return
    }

    const indexOfLastSep = deletedPath.lastIndexOf(FS_SEP)
    const moduleId = deletedPath.substring(indexOfLastSep + 1)
    this.onModuleDeleted(moduleId)
  }
}

function parseCollection(document: Document, moduleObjectResolver: (id: string) => TocTreeModule): TocTreeCollection {
  const metadata = document.getElementsByTagNameNS(NS_COLLECTION, 'metadata')[0]
  const collectionTitle = metadata.getElementsByTagNameNS(NS_METADATA, 'title')[0].textContent
  const collectionSlug = metadata.getElementsByTagNameNS(NS_METADATA, 'slug')[0].textContent

  const treeRoot = document.getElementsByTagNameNS(NS_COLLECTION, 'content')[0]

  const moduleToObject = (element: Element): TocTreeModule => {
    const moduleid = element.getAttribute('document')
    return moduleObjectResolver(moduleid ?? '')
  }

  const subcollectionToObject = (element: Element): TocTreeCollection => {
    const title = element.getElementsByTagNameNS(NS_METADATA, 'title')[0].textContent
    const content = element.getElementsByTagNameNS(NS_COLLECTION, 'content')[0]
    return {
      type: TocTreeElementType.subcollection,
      title: expect(title, 'Subcollection title missing'),
      children: childObjects(content)
    }
  }

  const childObjects = (element: Element): TocTreeElement[] => {
    const children = []
    for (const child of Array.from<any>(element.childNodes)) {
      if (child.localName === 'module') {
        children.push(moduleToObject(child))
      } else if (child.localName === 'subcollection') {
        children.push(subcollectionToObject(child))
      }
    }
    return children
  }

  return {
    type: TocTreeElementType.collection,
    title: expect(collectionTitle, 'Collection title missing'),
    slug: expect(collectionSlug, 'Collection slug missing'),
    children: childObjects(treeRoot)
  }
}
