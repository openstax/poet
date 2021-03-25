import { DOMParser } from 'xmldom'
import path from 'path'
import fs from 'fs'
import { FileChangeType, FileEvent } from 'vscode-languageserver/node'
import * as xpath from 'xpath-ts'
import { expect } from './utils'
import { TocTreeModule, TocTreeCollection, TocTreeElement } from '../../common/src/toc-tree'
import {
  URI
} from 'vscode-uri'
import memoizeOne from 'memoize-one'
import { v4 as uuidv4 } from 'uuid'

export const NS_COLLECTION = 'http://cnx.rice.edu/collxml'
export const NS_CNXML = 'http://cnx.rice.edu/cnxml'
export const NS_METADATA = 'http://cnx.rice.edu/mdml'

const select = xpath.useNamespaces({ cnxml: NS_CNXML, col: NS_COLLECTION, md: NS_METADATA })

export interface Link {
  moduleid: string
  targetid: string
}
export interface FileData { data: string }
export interface ModuleTitle { title: string, moduleid: string }

export type Cachified<T> = CacheVerified & Wraps<T>
export interface CacheVerified {
  cacheKey: string
}
export interface Wraps<T> {
  inner: T
}

export const cachify = <T>(inner: T): Cachified<T> => {
  return {
    cacheKey: uuidv4(),
    inner
  }
}
export const recachify = <T>(cachified: Cachified<T>): Cachified<T> => {
  return {
    cacheKey: uuidv4(),
    inner: cachified.inner
  }
}

export const cacheEquals = (one: CacheVerified, other: CacheVerified): boolean => {
  return one.cacheKey === other.cacheKey
}

export const cacheListsEqual = (one: CacheVerified[], other: CacheVerified[]): boolean => {
  if (one.length !== other.length) {
    return false
  }
  for (let i = 0; i < one.length; i++) {
    const item = one[i]
    const otherItem = other[i]
    if (!cacheEquals(item, otherItem)) {
      return false
    }
  }
  return true
}

// works for singular and one-level nested array and set args
// one-level nested array cache equality is order dependent
export const cacheArgsEqual = (args: Array<CacheVerified | CacheVerified[]>, otherArgs: Array<CacheVerified | CacheVerified[]>): boolean => {
  if (args.length !== otherArgs.length) {
    return false
  }
  for (let i = 0; i < args.length; i++) {
    const item = args[i]
    const otherItem = otherArgs[i]
    if (item instanceof Array !== otherItem instanceof Array) {
      return false
    }
    if (item instanceof Array) {
      if (!cacheListsEqual(item, otherItem as CacheVerified[])) {
        return false
      }
    } else {
      if (!cacheEquals(item, otherItem as CacheVerified)) {
        return false
      }
    }
  }
  return true
}

export const cacheSort = <T extends CacheVerified>(items: T[]): T[] => {
  return items.sort((a, b) => a.cacheKey.localeCompare(b.cacheKey))
}

const memoizeOneCache = <T extends (this: any, ...newArgs: any[]) => ReturnType<T>>(args: T): T => {
  return memoizeOne(args, cacheArgsEqual)
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
          targetid: expect(linkNode.getAttribute('target-id'), 'selection requires attribute exists')
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

  async modulesUsed(): Promise<Cachified<Set<string>>> {
    const document = await this.document()
    return this._modulesUsed(document)
  }

  private readonly _modulesUsed = memoizeOneCache(
    ({ inner: doc }: Cachified<Document>) => {
      const modules = new Set<string>()
      const moduleNodes = select('//col:module[@document]', doc) as Element[]
      for (const moduleNode of moduleNodes) {
        modules.add(expect(moduleNode.getAttribute('document'), 'selection requires attribute exists'))
      }
      return cachify(modules)
    }
  )

  async tree(): Promise<Cachified<TocTreeCollection>> {
    const document = await this.document()
    const modulesUsed = Array.from((await this.modulesUsed()).inner)
    const moduleTitles = await Promise.all(modulesUsed.map(async module => await this.bundle.moduleTitle(module)))
    const moduleTitlesDefined = moduleTitles.filter(t => t !== undefined) as Array<Cachified<ModuleTitle>>
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
      const foundImages = await fs.promises.readdir(path.join(workspaceRoot, 'media'))
      for (const image of foundImages) {
        set.add(image)
      }
    }
    const loadModules = async (bundle: BookBundle, map: Map<string, ModuleInfo>): Promise<void> => {
      const foundModules = await fs.promises.readdir(path.join(workspaceRoot, 'modules'))
      for (const module of foundModules) {
        map.set(module, new ModuleInfo(bundle, module))
      }
    }
    const loadCollections = async (bundle: BookBundle, map: Map<string, CollectionInfo>): Promise<void> => {
      const foundCollections = await fs.promises.readdir(path.join(workspaceRoot, 'collections'))
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

  images(): string[] {
    return Array.from(this.imagesInternal.inner.values())
  }

  modules(): string[] {
    return Array.from(this.modulesInternal.inner.keys())
  }

  collections(): string[] {
    return Array.from(this.collectionsInternal.inner.keys())
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
    (allModules: Cachified<Map<string, ModuleInfo>>, usedModulesPerCollection: Array<Cachified<Set<string>>>): Cachified<Set<string>> => {
      const orphanModules = new Set(allModules.inner.keys())
      for (const collectionModules of usedModulesPerCollection) {
        for (const module of collectionModules.inner) {
          orphanModules.delete(module)
        }
      }
      return cachify(orphanModules)
    }
  )

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
    const itemPath = URI.parse(change.uri).fsPath
    const sep = path.join('/')
    const itemPathRelative = itemPath.replace(`${this.workspaceRoot()}${sep}`, '')
    const indexOfFirstSep = itemPathRelative.indexOf(sep)
    const itemType = itemPathRelative.substring(0, indexOfFirstSep)
    if (itemType === 'collections') {
      const filename = itemPathRelative.substring(indexOfFirstSep + 1)
      const func = {
        [FileChangeType.Created]: this.onCollectionCreated,
        [FileChangeType.Changed]: this.onCollectionChanged,
        [FileChangeType.Deleted]: this.onCollectionDeleted
      }[change.type].bind(this)
      func(filename)
      return
    } else if (itemType === 'modules') {
      if (!itemPathRelative.endsWith(`${sep}index.cnxml`)) {
        // Directory or some irrelevant file was edited
        return
      }
      const indexOfSecondSep = itemPathRelative.indexOf(sep, indexOfFirstSep + 1)
      const moduleid = itemPathRelative.substring(indexOfFirstSep + 1, indexOfSecondSep)
      const func = {
        [FileChangeType.Created]: this.onModuleCreated,
        [FileChangeType.Changed]: this.onModuleChanged,
        [FileChangeType.Deleted]: this.onModuleDeleted
      }[change.type].bind(this)
      func(moduleid)
      return
    } else if (itemType === 'media') {
      const mediaFilename = itemPathRelative.substring(indexOfFirstSep + 1)
      const func = {
        [FileChangeType.Created]: this.onImageCreated,
        [FileChangeType.Changed]: this.onImageChanged,
        [FileChangeType.Deleted]: this.onImageDeleted
      }[change.type].bind(this)
      func(mediaFilename)
      return
    }
    throw new Error('unreachable')
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
