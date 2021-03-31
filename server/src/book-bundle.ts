import { DOMParser } from 'xmldom'
import path from 'path'
import fs from 'fs'
import { FileChangeType, FileEvent } from 'vscode-languageserver/node'
import * as xpath from 'xpath-ts'
import { expect, fileExists } from './utils'
import { TocTreeModule, TocTreeCollection, TocTreeElement } from '../../common/src/toc-tree'
import {
  URI
} from 'vscode-uri'
import { cacheSort, Cachified, cachify, memoizeOneCache, recachify } from './cachify'

export const NS_COLLECTION = 'http://cnx.rice.edu/collxml'
export const NS_CNXML = 'http://cnx.rice.edu/cnxml'
export const NS_METADATA = 'http://cnx.rice.edu/mdml'

const FS_SEP = path.join('/')

const select = xpath.useNamespaces({ cnxml: NS_CNXML, col: NS_COLLECTION, md: NS_METADATA })

export interface Link {
  moduleid: string,
  targetid: string,
  element: any
}

export interface FileData { data: string }

export interface ModuleTitle { title: string, moduleid: string }

export interface ImageSource {
  name: string,
  path: string,
  element: any,
  inBundleMedia: boolean,
  exists: boolean
}

export interface ModuleLink {
  moduleid: string,
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
  private fileDataInternal: Cachified<FileData> | null = null
  constructor(private readonly bundle: BookBundle, readonly moduleid: string) {}
  async fileData(): Promise<Cachified<FileData>> {
    if (this.fileDataInternal == null) {
      const modulePath = path.join(this.bundle.workspaceRoot(), 'modules', this.moduleid, 'index.cnxml')
      const data = await fs.promises.readFile(modulePath, { encoding: 'utf-8' })
      this.fileDataInternal = cachify({ data })
    }
    return this.fileDataInternal
  }

  async document(): Promise<Cachified<Document>> {
    const fileData = await this.fileData()
    return this._document(fileData)
  }

  private readonly _document = memoizeOneCache(
    ({ inner }: Cachified<FileData>): Cachified<Document> => {
      return cachify(new DOMParser().parseFromString(inner.data))
    }
  )

  async idsDeclared(): Promise<Cachified<Map<string, Element[]>>> {
    const document = await this.document()
    return this._idsDeclared(document)
  }

  private readonly _idsDeclared = memoizeOneCache(
    ({ inner: doc }: Cachified<Document>) => {
      const ids = new Map<string, Element[]>()
      const idNodes = select('//cnxml:*[@id]', doc) as Element[]
      for (const idNode of idNodes) {
        const id = expect(idNode.getAttribute('id'), 'selection requires attribute exists')
        const existing = ids.get(id)
        if (existing != null) {
          existing.push(idNode)
        } else {
          ids.set(id, [idNode])
        }
      }
      return cachify(ids)
    }
  )

  async imagesUsed(): Promise<Cachified<Set<string>>> {
    const document = await this.document()
    return this._imagesUsed(document)
  }

  async imageSources(): Promise<Cachified<ImageSource[]>> {
    const document = await this.document()
    return await this._imageSources(document)
  }

  private readonly _imageSources = memoizeOneCache(
    async ({ inner: doc }: Cachified<Document>) => {
      const imageNodes = select('//cnxml:image[@src]', doc) as Element[]
      const imageSourceFromNode = async (imageNode: Element): Promise<ImageSource> => {
        const source = expect(imageNode.getAttribute('src'), 'selection requires attribute exists')
        const basename = path.basename(source)
        // Assume this module is found in /modules/*/index.cnxml and image src is a relative path
        const mediaSourceResolved = path.resolve(this.bundle.moduleDirectory(), source)
        const inBundleMedia = this.bundle.imageExists(basename) && path.dirname(mediaSourceResolved) === this.bundle.mediaDirectory()
        return {
          name: basename,
          path: source,
          inBundleMedia,
          exists: inBundleMedia || await fileExists(source),
          element: imageNode
        }
      }
      return cachify(await Promise.all(imageNodes.map(async (imageNode) => await imageSourceFromNode(imageNode))))
    }
  )

  private readonly _imagesUsed = memoizeOneCache(
    ({ inner: doc }: Cachified<Document>) => {
      const images = new Set<string>()
      const imageNodes = select('//cnxml:image[@src]', doc) as Element[]
      for (const imageNode of imageNodes) {
        const source = expect(imageNode.getAttribute('src'), 'selection requires attribute exists')
        const basename = path.basename(source)
        images.add(basename)
      }
      return cachify(images)
    }
  )

  async linksDelared(): Promise<Cachified<Link[]>> {
    const document = await this.document()
    return this._linksDeclared(document)
  }

  private readonly _linksDeclared = memoizeOneCache(
    ({ inner: doc }: Cachified<Document>) => {
      const links: Link[] = []
      const linkNodes = select('//cnxml:link[@target-id]', doc) as Element[]
      for (const linkNode of linkNodes) {
        let documentid = linkNode.getAttribute('document')
        documentid = documentid == null ? this.moduleid : documentid
        documentid = documentid === '' ? this.moduleid : documentid
        links.push({
          moduleid: documentid,
          targetid: expect(linkNode.getAttribute('target-id'), 'selection requires attribute exists'),
          element: linkNode
        })
      }
      return cachify(links)
    }
  )

  async title(): Promise<Cachified<ModuleTitle>> {
    const fileData = await this.fileData()
    const guessedTitle = this._guessFromFileData(fileData)
    if (guessedTitle != null) {
      return guessedTitle
    }
    const document = await this.document()
    return this._titleFromDocument(document)
  }

  private _moduleTitleFromString(titleString: string): ModuleTitle {
    return { title: titleString, moduleid: this.moduleid }
  }

  private readonly _titleFromDocument = memoizeOneCache(
    ({ inner: doc }: Cachified<Document>): Cachified<ModuleTitle> => {
      try {
        const metadata = doc.getElementsByTagNameNS(NS_CNXML, 'metadata')[0]
        const moduleTitle = metadata.getElementsByTagNameNS(NS_METADATA, 'title')[0].textContent
        return cachify(this._moduleTitleFromString(moduleTitle ?? 'Unnamed Module'))
      } catch {
        return cachify(this._moduleTitleFromString('Unnamed Module'))
      }
    }
  )

  private readonly _guessFromFileData = memoizeOneCache(
    ({ inner }: Cachified<FileData>): Cachified<ModuleTitle> | null => {
      const { data } = inner
      const titleTagStart = data.indexOf('<md:title>')
      const titleTagEnd = data.indexOf('</md:title>')
      if (titleTagStart === -1 || titleTagEnd === -1) {
        return null
      }
      const actualTitleStart = titleTagStart + 10 // Add length of '<md:title>'
      if (titleTagEnd - actualTitleStart > 280) {
        // If the title is so long you can't tweet it,
        // then something probably went wrong.
        return null
      }
      const moduleTitle = data.substring(actualTitleStart, titleTagEnd).trim()
      return cachify(this._moduleTitleFromString(moduleTitle))
    }
  )
}

class CollectionInfo {
  private fileDataInternal: Cachified<FileData> | null = null
  constructor(private readonly bundle: BookBundle, readonly filename: string) {}
  async fileData(): Promise<Cachified<FileData>> {
    if (this.fileDataInternal == null) {
      const modulePath = path.join(this.bundle.workspaceRoot(), 'collections', this.filename)
      const data = fs.readFileSync(modulePath, { encoding: 'utf-8' })
      this.fileDataInternal = cachify({ data })
    }
    return this.fileDataInternal
  }

  async document(): Promise<Cachified<Document>> {
    const fileData = await this.fileData()
    return this._document(fileData)
  }

  private readonly _document = memoizeOneCache(
    ({ inner }: Cachified<FileData>): Cachified<Document> => {
      return cachify(new DOMParser().parseFromString(inner.data))
    }
  )

  async modulesUsed(): Promise<Cachified<ModuleLink[]>> {
    const document = await this.document()
    return this._modulesUsed(document)
  }

  private readonly _modulesUsed = memoizeOneCache(
    ({ inner: doc }: Cachified<Document>) => {
      const modules: ModuleLink[] = []
      const moduleNodes = select('//col:module', doc) as Element[]
      for (const moduleNode of moduleNodes) {
        const moduleid = moduleNode.getAttribute('document') ?? ''
        modules.push({
          element: moduleNode,
          moduleid: moduleid
        })
      }
      return cachify(modules)
    }
  )

  async tree(): Promise<Cachified<TocTreeCollection>> {
    const document = await this.document()
    const modulesUsed = await this.modulesUsed()
    const moduleTitles = await Promise.all(modulesUsed.inner.map(async moduleLink => await this.bundle.moduleTitle(moduleLink.moduleid)))
    const moduleTitlesDefined = moduleTitles.filter(t => t != null) as Array<Cachified<ModuleTitle>>
    return this._tree(document, cacheSort(moduleTitlesDefined))
  }

  private readonly _tree = memoizeOneCache(
    async ({ inner: doc }: Cachified<Document>, titles: Array<Cachified<ModuleTitle>>) => {
      const moduleTitleMap = new Map<string, string>()
      for (const entry of titles) {
        moduleTitleMap.set(entry.inner.moduleid, entry.inner.title)
      }
      const moduleToObjectResolver = (moduleid: string): TocTreeModule => {
        return {
          type: 'module',
          moduleid: moduleid,
          title: moduleTitleMap.get(moduleid) ?? '**DOES NOT EXIST**',
          subtitle: moduleid
        }
      }
      const tree = parseCollection(doc, moduleToObjectResolver)
      return cachify(tree)
    }
  )
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
      const foundImages = await fs.promises.readdir(bundle.mediaDirectory())
      for (const image of foundImages) {
        set.add(image)
      }
    }
    const loadModules = async (bundle: BookBundle, map: Map<string, ModuleInfo>): Promise<void> => {
      const foundModules = await fs.promises.readdir(bundle.moduleDirectory())
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

  mediaItems(): BundleItem[] {
    return Array.from(this.imagesInternal.inner.values()).map(key => ({ type: 'media', key: key }))
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
      path: path.join(this.workspaceRoot(), item.type, item.key),
    }).toString()
  }

  async orphanedImages(): Promise<Cachified<Set<string>>> {
    const usedImagesPerModule = await Promise.all(Array.from(this.modulesInternal.inner.values()).map(async module => await module.imagesUsed()))
    return this._orphanedImages(this.imagesInternal, cacheSort(usedImagesPerModule))
  }

  private readonly _orphanedImages = memoizeOneCache(
    (allImages: Cachified<Set<string>>, usedImagesPerModule: Array<Cachified<Set<string>>>): Cachified<Set<string>> => {
      const orphanImages = new Set(allImages.inner)
      for (const moduleImages of usedImagesPerModule) {
        for (const image of moduleImages.inner) {
          orphanImages.delete(image)
        }
      }
      return cachify(orphanImages)
    }
  )

  async orphanedModules(): Promise<Cachified<Set<string>>> {
    const usedModulesPerCollection = await Promise.all(Array.from(this.collectionsInternal.inner.values()).map(async collection => await collection.modulesUsed()))
    return this._orphanedModules(this.modulesInternal, cacheSort(usedModulesPerCollection))
  }

  private readonly _orphanedModules = memoizeOneCache(
    (allModules: Cachified<Map<string, ModuleInfo>>, usedModulesPerCollection: Array<Cachified<ModuleLink[]>>): Cachified<Set<string>> => {
      const orphanModules = new Set(allModules.inner.keys())
      for (const collectionModules of usedModulesPerCollection) {
        for (const moduleLink of collectionModules.inner) {
          orphanModules.delete(moduleLink.moduleid)
        }
      }
      return cachify(orphanModules)
    }
  )

  async modulesUsed(filename: string): Promise<Cachified<ModuleLink[]> | null> {
    const collectionInfo = this.collectionsInternal.inner.get(filename)
    if (collectionInfo == null) {
      return null
    }
    return await collectionInfo.modulesUsed()
  }

  async moduleTitle(moduleid: string): Promise<Cachified<ModuleTitle> | null> {
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
    return (await moduleInfo.idsDeclared()).inner.has(id)
  }

  async isIdUniqueInModule(id: string, moduleid: string): Promise<boolean> {
    const moduleInfo = this.modulesInternal.inner.get(moduleid)
    if (moduleInfo == null) {
      return false
    }
    const elements = (await moduleInfo.idsDeclared()).inner.get(id)
    if (elements == null) {
      return false
    }
    return elements.length === 1
  }

  async moduleLinks(moduleid: string): Promise<Cachified<Link[]> | null> {
    const moduleInfo = this.modulesInternal.inner.get(moduleid)
    if (moduleInfo == null) {
      return null
    }
    return await moduleInfo.linksDelared()
  }

  async moduleIds(moduleid: string): Promise<Cachified<Set<string>> | null> {
    const moduleInfo = this.modulesInternal.inner.get(moduleid)
    if (moduleInfo == null) {
      return null
    }
    return this._moduleIds(await moduleInfo.idsDeclared())
  }

  private readonly _moduleIds = memoizeOneCache(
    (moduleIdsAsMap: Cachified<Map<string, Element[]>>): Cachified<Set<string>> => {
      return cachify(new Set(moduleIdsAsMap.inner.keys()))
    }
  )

  async moduleImageSources(moduleid: string): Promise<Cachified<ImageSource[]> | null> {
    const moduleInfo = this.modulesInternal.inner.get(moduleid)
    if (moduleInfo == null) {
      return null
    }
    return await moduleInfo.imageSources()
  }

  async moduleImages(moduleid: string): Promise<Cachified<Set<string>> | null> {
    const moduleInfo = this.modulesInternal.inner.get(moduleid)
    if (moduleInfo == null) {
      return null
    }
    return await moduleInfo.imagesUsed()
  }

  async collectionTree(filename: string): Promise<Cachified<TocTreeCollection> | null> {
    const collectionInfo = this.collectionsInternal.inner.get(filename)
    if (collectionInfo == null) {
      return null
    }
    return await collectionInfo.tree()
  }

  async moduleAsTreeObject(moduleid: string): Promise<TocTreeModule> {
    const title = await this.moduleTitle(moduleid)
    return {
      type: 'module',
      moduleid: moduleid,
      title: title?.inner.title ?? 'Unnamed Module',
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
    const item = this.bundleItemFromUri(change.uri)
    if (item == null) {
      return
    }
    if (!this.containsBundleItem(item)) {
      throw new Error(`BUG: Key '${item.key}' invalid for item type '${item.type}'`)
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
      type: 'subcollection',
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
    type: 'collection',
    title: expect(collectionTitle, 'Collection title missing'),
    slug: expect(collectionSlug, 'Collection slug missing'),
    children: childObjects(treeRoot)
  }
}
