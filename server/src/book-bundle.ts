import { DOMParser } from 'xmldom'
import path from 'path'
import fs from 'fs'
import { FileChangeType, FileEvent, Position } from 'vscode-languageserver/node'
import * as xpath from 'xpath-ts'
import Immutable from 'immutable'
import * as Quarx from 'quarx'
import { calculateElementPositions, expect, fileExistsAt, fileExistsAtSync } from './utils'
import { TocTreeModule, TocTreeCollection, TocTreeElement, TocTreeElementType } from '../../common/src/toc-tree'
import {
  URI
} from 'vscode-uri'
import { cacheSort, Cachified, cachify, memoizeOneCache, recachify } from './cachify'

export const NS_COLLECTION = 'http://cnx.rice.edu/collxml'
export const NS_CNXML = 'http://cnx.rice.edu/cnxml'
export const NS_METADATA = 'http://cnx.rice.edu/mdml'

const FS_SEP = path.sep

const select = xpath.useNamespaces({ cnxml: NS_CNXML, col: NS_COLLECTION, md: NS_METADATA })

const toJSMap = <K,V>(i: Immutable.Map<K,V>) => new Map(i.entries())
const fromJSMap = <K,V>(m: Map<K,V>) => Immutable.Map(m.entries())
const toJSSet = <V>(i: Immutable.Set<V>) => new Set(i.values())


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

type ImageWithPosition = {
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
  private __isLoaded = false
  private __idsDeclared = Quarx.observable.box(Immutable.Map<string, number>())
  private __imagesUsed = Quarx.observable.box(Immutable.Set<ImageWithPosition>())
  private __linksDeclared = Quarx.observable.box(Immutable.Set<Link>())
  private __titleFromDocument = Quarx.observable.box<string|null>(null)

  constructor(private readonly bundle: BookBundle, readonly moduleid: string) {}

  private async _readFile() {
    const modulePath = path.join(this.bundle.workspaceRoot(), 'modules', this.moduleid, 'index.cnxml')
    return await fs.promises.readFile(modulePath, { encoding: 'utf-8' })
  }

  async refresh() {
    const xml = await this._readFile()
    const doc = new DOMParser().parseFromString(xml)
    if (!doc) return
    this.__idsDeclared.set(this.phil_idsDeclared(doc))
    this.__imagesUsed.set(this.phil_imagesUsed(doc)) // need to path.basename(x) and unwrapso .imagesUsed() only returns strings
    this.__linksDeclared.set(this.phil_linksDeclared(doc))
    this.__titleFromDocument.set(this.phil_titleFromDocument(doc))
    this.__isLoaded = true
  }

  private async _loadIfNeeded() {
    if (!this.__isLoaded) {
      await this.refresh()
      this.__isLoaded = true
    }
  }

  async idsDeclared(): Promise<Immutable.Map<string, number>> {
    await this._loadIfNeeded()
    return this.__idsDeclared.get()
  }

  private phil_idsDeclared(doc: Document) {
    const idNodes = select('//cnxml:*[@id]', doc) as Element[]
    return Immutable.Map<string, number>().withMutations(map => {
      for (const idNode of idNodes) {
        const id = expect(idNode.getAttribute('id'), 'selection requires attribute exists')
        const existing = map.get(id) || 0
        map.set(id, existing+1)
      }
    })
  }

  private phil_imagesUsed(doc: Document) {
    const imageNodes = select('//cnxml:image[@src]', doc) as Element[]
    return Immutable.Set<ImageWithPosition>().withMutations(s => {
      for (const imageNode of imageNodes) {
        const relPath = expect(imageNode.getAttribute('src'), 'selection requires attribute exists')
        const [startPos, endPos] = calculateElementPositions(imageNode)
        s.add({
          relPath,
          startPos,
          endPos,
        })
      }
    })
  }

  private phil_linksDeclared(doc: Document) {
    const linkNodes = select('//cnxml:link', doc) as Element[]
    return Immutable.Set<Link>().withMutations(s =>{
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

  private phil_titleFromDocument(doc: Document) {
    const titleNode = select('//cnxml:title', doc) as Element[]
    if (titleNode[0]) {
      return titleNode[0].textContent || ''
    }
    return 'Unnamed Module'
  }

  async imagesUsed(): Promise<Immutable.Set<ImageWithPosition>> {
    await this._loadIfNeeded()
    return this.__imagesUsed.get()
  }

  async imageSources(bundleMedia: Set<string>): Promise<Immutable.Set<ImageSource>> {
    await this._loadIfNeeded()
    // TODO: Make this async again (remove fileExistsAtSync)
    return this.__imagesUsed.get().map(img => {
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

  async linksDelared(): Promise<Immutable.Set<Link>> {
    await this._loadIfNeeded()
    return this.__linksDeclared.get()
  }

  async title(): Promise<ModuleTitle> {
    if (this.__titleFromDocument.get() === null) {
      const fileData = await this._readFile()
      const guessedTitle = this._guessFromFileData(fileData)
      if (guessedTitle != null) {
        this.__titleFromDocument.set(guessedTitle.title)
        return guessedTitle
      }
    }
    await this.refresh()
    return this._moduleTitleFromString(this.__titleFromDocument.get() || '')
  }

  private _moduleTitleFromString(titleString: string): ModuleTitle {
    return { title: titleString, moduleid: this.moduleid }
  }

  private _guessFromFileData(data: string) {
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
  private __isLoaded = false
  private __modulesUsed = Quarx.observable.box(Immutable.Set<ModuleLink>())
  // UGH, Store document in memory because some code relies on thrown exceptions to send diagnostics
  // that the collection.xml file is invalid.
  // So, we cache the DOM but delay actually parsing the fields (like title, uuid, slug, etc) until later.
  // TODO: Maybe there is a better way.
  private __doc = Quarx.observable.box(new DOMParser().parseFromString('<unparsed-file-yet/>'))

  constructor(private readonly bundle: BookBundle, readonly filename: string) {}
  
  private async _readFile() {
    const modulePath = path.join(this.bundle.workspaceRoot(), 'collections', this.filename)
    return fs.promises.readFile(modulePath, { encoding: 'utf-8' })
  }
  private async _loadIfNeeded() {
    if (!this.__isLoaded) {
      await this.refresh()
    }
  }

  public async refresh() {
    const xml = await this._readFile()
    const doc = new DOMParser().parseFromString(xml)
    if (!doc) return
    this.__modulesUsed.set(this.phil_modulesUsed(doc))
    this.__doc.set(doc)
    this.__isLoaded = true
  }
  
  async modulesUsed(): Promise<Immutable.Set<ModuleLink>> {
    await this._loadIfNeeded()
    return this.__modulesUsed.get()
  }

  private phil_modulesUsed(doc: Document) {
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

  async tree(): Promise<TocTreeCollection> {
    await this._loadIfNeeded()
    return await this.phil2_tree(this.__doc.get())
  }

  private async phil2_tree(doc: Document) {
    debugger
    const modulesUsed = this.__modulesUsed.get()
    const moduleTitles = await Promise.all(modulesUsed.map(async moduleLink => await this.bundle.moduleTitle(moduleLink.moduleid)))
    const moduleTitlesDefined = moduleTitles.filter(t => t != null) as Array<ModuleTitle>
    return this.phil_tree(doc, moduleTitlesDefined)
  }

  private phil_tree(doc: Document, titles: ModuleTitle[]) {
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

export class BookBundle {
  constructor(
    readonly workspaceRootInternal: string,
    private imagesInternal: Cachified<Set<string>>,
    private modulesInternal: Cachified<Map<string, ModuleInfo>>,
    private collectionsInternal: Cachified<Map<string, CollectionInfo>>
  ) {}

  static async from(workspaceRoot: string): Promise<BookBundle> {
    const images = cachify(new Set<string>())
    const modules = cachify(new Map<string, ModuleInfo>())
    const collections = cachify(new Map<string, CollectionInfo>())
    const bundle = new BookBundle(workspaceRoot, images, modules, collections)
    const loadImages = async (bundle: BookBundle, set: Set<string>): Promise<void> => {
      try { // media directory may not exist
        const foundImages = await fs.promises.readdir(bundle.mediaDirectory())
        for (const image of foundImages) {
          set.add(image)
        }
      } catch (err) { }
    }
    const loadModules = async (bundle: BookBundle, map: Map<string, ModuleInfo>): Promise<void> => {
      const foundPossibleModules = await fs.promises.readdir(bundle.moduleDirectory())
      const moduleCnxmlExists = await Promise.all(foundPossibleModules.map(
        (moduleId) => (path.join(bundle.moduleDirectory(), moduleId, 'index.cnxml'))
      ).map(fileExistsAt))
      const foundModules = foundPossibleModules.filter((_, indx) => moduleCnxmlExists[indx])
      for (const module of foundModules) {
        map.set(module, new ModuleInfo(bundle, module))
      }
    }
    const loadCollections = async (bundle: BookBundle, map: Map<string, CollectionInfo>): Promise<void> => {
      const foundCollections = await fs.promises.readdir(bundle.collectionDirectory())
      for (const collection of foundCollections) {
        map.set(collection, new CollectionInfo(bundle, collection))
      }
    }
    await Promise.all([loadImages(bundle, images.inner), loadModules(bundle, modules.inner), loadCollections(bundle, collections.inner)])
    return bundle
  }

  workspaceRoot(): string {
    return this.workspaceRootInternal
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
    return Array.from(this.imagesInternal.inner.values())
  }

  modules(): string[] {
    return Array.from(this.modulesInternal.inner.keys())
  }

  moduleItems(): BundleItem[] {
    return Array.from(this.modulesInternal.inner.keys()).map(key => ({ type: 'modules', key: key }))
  }

  collections(): string[] {
    return Array.from(this.collectionsInternal.inner.keys())
  }

  collectionItems(): BundleItem[] {
    return Array.from(this.collectionsInternal.inner.keys()).map(key => ({ type: 'collections', key: key }))
  }

  imageExists(name: string): boolean {
    return this.imagesInternal.inner.has(name)
  }

  moduleExists(moduleid: string): boolean {
    return this.modulesInternal.inner.has(moduleid)
  }

  collectionExists(filename: string): boolean {
    return this.collectionsInternal.inner.has(filename)
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

  async orphanedImages(): Promise<Cachified<Set<string>>> {
    const usedImagesPerModule = await Promise.all(Array.from(this.modulesInternal.inner.values()).map(async module => await module.imagesUsed()))
    return this._orphanedImages(this.imagesInternal, usedImagesPerModule)
  }

  private readonly _orphanedImages = memoizeOneCache(
    (allImages: Cachified<Set<string>>, usedImagesPerModule: Array<Immutable.Set<ImageWithPosition>>): Cachified<Set<string>> => {
      const orphanImages = new Set(allImages.inner)
      for (const moduleImages of usedImagesPerModule) {
        for (const image of moduleImages) {
          orphanImages.delete(path.basename(image.relPath))
        }
      }
      return cachify(orphanImages)
    }
  )

  async orphanedModules(): Promise<Immutable.Set<string>> {
    const usedModulesPerCollection = await Promise.all(Array.from(this.collectionsInternal.inner.values()).map(async collection => await collection.modulesUsed()))
    return this._orphanedModules(this.modulesInternal, usedModulesPerCollection)
  }

  private _orphanedModules(allModules: Cachified<Map<string, ModuleInfo>>, usedModulesPerCollection: Array<Immutable.Set<ModuleLink>>): Immutable.Set<string> {
    return Immutable.Set(allModules.inner.keys()).withMutations(s => {
      for (const collectionModules of usedModulesPerCollection) {
        for (const moduleLink of collectionModules) {
          s.delete(moduleLink.moduleid)
        }
      }
    })  
  }  

  async modulesUsed(filename: string): Promise<Immutable.Set<ModuleLink> | null> {
    const collectionInfo = this.collectionsInternal.inner.get(filename)
    if (collectionInfo == null) {
      return null
    }
    return await collectionInfo.modulesUsed()
  }

  async moduleTitle(moduleid: string): Promise<ModuleTitle | null> {
    const moduleInfo = this.modulesInternal.inner.get(moduleid)
    if (moduleInfo == null) {
      return null
    }
    return await moduleInfo.title()
  }

  async isIdInModule(id: string, moduleid: string): Promise<boolean> {
    const moduleInfo = this.modulesInternal.inner.get(moduleid)
    if (moduleInfo == null) {
      return false
    }
    return (await moduleInfo.idsDeclared()).has(id)
  }

  async isIdUniqueInModule(id: string, moduleid: string): Promise<boolean> {
    const moduleInfo = this.modulesInternal.inner.get(moduleid)
    if (moduleInfo == null) {
      return false
    }
    const elements = (await moduleInfo.idsDeclared()).get(id)
    if (elements == 0) {
      return false
    }
    return elements === 1
  }

  async moduleLinks(moduleid: string): Promise<Immutable.Set<Link> | null> {
    const moduleInfo = this.modulesInternal.inner.get(moduleid)
    if (moduleInfo == null) {
      return null
    }
    return await moduleInfo.linksDelared()
  }

  async moduleIds(moduleid: string): Promise<Immutable.Set<string> | null> {
    const moduleInfo = this.modulesInternal.inner.get(moduleid)
    if (moduleInfo == null) {
      return null
    }
    return Immutable.Set((await moduleInfo.idsDeclared()).keys())
  }

  async moduleImageSources(moduleid: string): Promise<Immutable.Set<ImageSource> | null> {
    const moduleInfo = this.modulesInternal.inner.get(moduleid)
    if (moduleInfo == null) {
      return null
    }
    return await moduleInfo.imageSources(this.imagesInternal.inner)
  }

  async _moduleImageFilenames(moduleid: string): Promise<Immutable.Set<string> | null> {
    const moduleInfo = this.modulesInternal.inner.get(moduleid)
    if (moduleInfo == null) {
      return null
    }
    return (await moduleInfo.imagesUsed()).map(i => path.basename(i.relPath))
  }

  async collectionTree(filename: string): Promise<TocTreeCollection | null> {
    const collectionInfo = this.collectionsInternal.inner.get(filename)
    if (collectionInfo == null) {
      return null
    }
    return await collectionInfo.tree()
  }

  async moduleAsTreeObject(moduleid: string): Promise<TocTreeModule> {
    const title = await this.moduleTitle(moduleid)
    return {
      type: TocTreeElementType.module,
      moduleid: moduleid,
      title: title?.title ?? 'Unnamed Module',
      subtitle: moduleid
    }
  }

  private onModuleCreated(moduleid: string): void {
    this.modulesInternal.inner.set(moduleid, new ModuleInfo(this, moduleid))
    this.modulesInternal = recachify(this.modulesInternal)
  }

  private onModuleChanged(moduleid: string): void {
    this.modulesInternal.inner.set(moduleid, new ModuleInfo(this, moduleid))
  }

  private onModuleDeleted(moduleid: string): void {
    this.modulesInternal.inner.delete(moduleid)
    this.modulesInternal = recachify(this.modulesInternal)
  }

  private onImageCreated(name: string): void {
    this.imagesInternal.inner.add(name)
    this.imagesInternal = recachify(this.imagesInternal)
  }

  private onImageChanged(name: string): void {}
  private onImageDeleted(name: string): void {
    this.imagesInternal.inner.delete(name)
    this.imagesInternal = recachify(this.imagesInternal)
  }

  private onCollectionCreated(filename: string): void {
    this.collectionsInternal.inner.set(filename, new CollectionInfo(this, filename))
    this.collectionsInternal = recachify(this.collectionsInternal)
  }

  private onCollectionChanged(filename: string): void {
    this.collectionsInternal.inner.set(filename, new CollectionInfo(this, filename))
  }

  private onCollectionDeleted(filename: string): void {
    this.collectionsInternal.inner.delete(filename)
    this.collectionsInternal = recachify(this.collectionsInternal)
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
      this.collections().forEach((col) => { this.onCollectionDeleted(col) })
      return
    }

    if (deletedPath === this.mediaDirectory()) {
      this.images().forEach((img) => { this.onImageDeleted(img) })
      return
    }

    // Process a module directory deletion which could be either the parent or
    // a specific module
    if (deletedPath === this.moduleDirectory()) {
      this.modules().forEach((module) => { this.onModuleDeleted(module) })
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
