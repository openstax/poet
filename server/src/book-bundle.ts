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

export type Cachified<T> = T & CacheVerified
export interface CacheVerified {
  cacheKey: string
  resetCacheKey: () => void
}

const cachify_next = <T extends object>(inner: T) => {
  const key = uuidv4()
  const handler = {
    get: (target: any, prop: any, receiver: any) => {
      const found = target[prop]
      if (prop === 'cacheKey') {
        return key
      }
      if (found instanceof Function) {
        return found.bind(target)
      }
      return found
    }
  }
  return new Proxy(inner, handler) as Cachified<T>
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
export const cachify = <T extends Record<string, any>>(arg: T): T & CacheVerified => {
  const generateKey = uuidv4
  const resetCacheKey = (bind: any) => () => {
    bind.cacheKey = generateKey()
  }
  const argAsAny = arg as any
  argAsAny.cacheKey = generateKey()
  argAsAny.resetCacheKey = resetCacheKey(arg)
  return arg as T & CacheVerified
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

  _document = memoizeOneCache(
    ({ data }: Cachified<FileData>): Cachified<Document> => {
      return cachify(new DOMParser().parseFromString(data))
    }
  )

  async idsDeclared(): Promise<Cachified<Map<string, Element[]>>> {
    const document = await this.document()
    return this._idsDeclared(document)
  }

  _idsDeclared = memoizeOneCache(
    (document: Cachified<Document>) => {
      const ids = new Map<string, Element[]>()
      const idNodes = select('//cnxml:*[@id]', document) as Element[]
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

  _imagesUsed = memoizeOneCache(
    (document: Cachified<Document>) => {
      const images = new Set<string>()
      const imageNodes = select('//cnxml:image[@src]', document) as Element[]
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

  _linksDeclared = memoizeOneCache(
    (document: Cachified<Document>) => {
      const links: Link[] = []
      const linkNodes = select('//cnxml:link[@target-id]', document) as Element[]
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

  _titleFromDocument = memoizeOneCache(
    (document: Cachified<Document>): Cachified<ModuleTitle> => {
      try {
        const metadata = document.getElementsByTagNameNS(NS_CNXML, 'metadata')[0]
        const moduleTitle = metadata.getElementsByTagNameNS(NS_METADATA, 'title')[0].textContent
        return cachify(this._moduleTitleFromString(moduleTitle ?? 'Unnamed Module'))
      } catch {
        return cachify(this._moduleTitleFromString('Unnamed Module'))
      }
    }
  )

  _guessFromFileData = memoizeOneCache(
    ({ data }: Cachified<FileData>): Cachified<ModuleTitle> | null => {
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
    ({ data }: Cachified<FileData>): Cachified<Document> => {
      return cachify(new DOMParser().parseFromString(data))
    }
  )

  async modulesUsed(): Promise<Cachified<Set<string>>> {
    const document = await this.document()
    return this._modulesUsed(document)
  }

  private readonly _modulesUsed = memoizeOneCache(
    (document: Cachified<Document>) => {
      const modules = new Set<string>()
      const moduleNodes = select('//col:module[@document]', document) as Element[]
      for (const moduleNode of moduleNodes) {
        modules.add(expect(moduleNode.getAttribute('document'), 'selection requires attribute exists'))
      }
      return cachify(modules)
    }
  )

  async tree(): Promise<Cachified<TocTreeCollection>> {
    const document = await this.document()
    const modulesUsed = Array.from(await this.modulesUsed())
    const moduleTitles = await Promise.all(modulesUsed.map(async module => await this.bundle.modulesInternal.get(module)?.title()))
    const moduleTitlesDefined = moduleTitles.filter(t => t !== undefined) as Array<Cachified<ModuleTitle>>
    return this._tree(document, cacheSort(moduleTitlesDefined))
  }

  private readonly _tree = memoizeOneCache(
    async (document: Cachified<Document>, titles: Array<Cachified<ModuleTitle>>) => {
      const moduleTitleMap = new Map<string, string>()
      for (const entry of titles) {
        moduleTitleMap.set(entry.moduleid, entry.title)
      }
      const moduleToObjectResolver = (moduleid: string): TocTreeModule => {
        return {
          type: 'module',
          moduleid: moduleid,
          title: moduleTitleMap.get(moduleid) ?? '**DOES NOT EXIST**',
          subtitle: moduleid
        }
      }
      const tree = parseCollection(document, moduleToObjectResolver)
      return cachify(tree)
    }
  )
}

export class BookBundle {
  constructor(
    readonly workspaceRootInternal: string,
    readonly imagesInternal: Cachified<Set<string>>,
    readonly modulesInternal: Cachified<Map<string, ModuleInfo>>,
    readonly collectionsInternal: Cachified<Map<string, CollectionInfo>>
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
    await Promise.all([loadImages(bundle, images), loadModules(bundle, modules), loadCollections(bundle, collections)])
    return bundle
  }

  workspaceRoot(): string {
    return this.workspaceRootInternal
  }

  images(): string[] {
    return Array.from(this.imagesInternal.values())
  }

  modules(): string[] {
    return Array.from(this.modulesInternal.keys())
  }

  collections(): string[] {
    return Array.from(this.collectionsInternal.keys())
  }

  imageExists(name: string): boolean {
    return this.imagesInternal.has(name)
  }

  moduleExists(moduleid: string): boolean {
    return this.modulesInternal.has(moduleid)
  }

  collectionExists(filename: string): boolean {
    return this.collectionsInternal.has(filename)
  }

  async orphanedImages(): Promise<Cachified<Set<string>>> {
    const usedImagesPerModule = await Promise.all(Array.from(this.modulesInternal.values()).map(async module => await module.imagesUsed()))
    return this._orphanedImages(this.imagesInternal, cacheSort(usedImagesPerModule))
  }

  private readonly _orphanedImages = memoizeOneCache(
    (allImages: Cachified<Set<string>>, usedImagesPerModule: Array<Cachified<Set<string>>>): Cachified<Set<string>> => {
      const orphanImages = new Set(allImages)
      for (const moduleImages of usedImagesPerModule) {
        for (const image of moduleImages) {
          orphanImages.delete(image)
        }
      }
      return cachify(orphanImages)
    }
  )

  async orphanedModules(): Promise<Cachified<Set<string>>> {
    const usedModulesPerCollection = await Promise.all(Array.from(this.collectionsInternal.values()).map(async collection => await collection.modulesUsed()))
    console.error(this)
    return this._orphanedModules(this.modulesInternal, cacheSort(usedModulesPerCollection))
  }

  private readonly _orphanedModules = memoizeOne(
    (allModules: Cachified<Map<string, ModuleInfo>>, usedModulesPerCollection: Array<Cachified<Set<string>>>): Cachified<Set<string>> => {
      const orphanModules = new Set(allModules.keys())
      for (const collectionModules of usedModulesPerCollection) {
        for (const module of collectionModules) {
          orphanModules.delete(module)
        }
      }
      return cachify(orphanModules)
    },
    (a,b) => {
      console.error(a)
      console.error(b)
      console.error('compare called')
      return false
    }
  )

  async moduleTitle(moduleid: string): Promise<Cachified<ModuleTitle> | null> {
    const moduleInfo = this.modulesInternal.get(moduleid)
    if (moduleInfo == null) {
      return null
    }
    return await moduleInfo.title()
  }

  async isIdInModule(id: string, moduleid: string): Promise<boolean> {
    const moduleInfo = this.modulesInternal.get(moduleid)
    if (moduleInfo == null) {
      return false
    }
    return (await moduleInfo.idsDeclared()).has(id)
  }

  async isIdUniqueInModule(id: string, moduleid: string): Promise<boolean> {
    const moduleInfo = this.modulesInternal.get(moduleid)
    if (moduleInfo == null) {
      return false
    }
    const elements = (await moduleInfo.idsDeclared()).get(id)
    if (elements == null) {
      return false
    }
    return elements.length === 1
  }

  async moduleLinks(moduleid: string): Promise<Cachified<Link[]> | null> {
    const moduleInfo = this.modulesInternal.get(moduleid)
    if (moduleInfo == null) {
      return null
    }
    return await moduleInfo.linksDelared()
  }

  async moduleIds(moduleid: string): Promise<Cachified<Set<string>> | null> {
    const moduleInfo = this.modulesInternal.get(moduleid)
    if (moduleInfo == null) {
      return null
    }
    return this._moduleIds(await moduleInfo.idsDeclared())
  }

  private readonly _moduleIds = memoizeOneCache(
    (moduleIdsAsMap: Cachified<Map<string, Element[]>>): Cachified<Set<string>> => {
      return cachify(new Set(moduleIdsAsMap.keys()))
    }
  )

  async moduleImages(moduleid: string): Promise<Cachified<Set<string>> | null> {
    const moduleInfo = this.modulesInternal.get(moduleid)
    if (moduleInfo == null) {
      return null
    }
    return await moduleInfo.imagesUsed()
  }

  async collectionTree(filename: string): Promise<Cachified<TocTreeCollection> | null> {
    const collectionInfo = this.collectionsInternal.get(filename)
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
      title: title?.title ?? 'Unnamed Module',
      subtitle: moduleid
    }
  }

  onModuleCreated(moduleid: string): void {
    this.modulesInternal.set(moduleid, new ModuleInfo(this, moduleid))
    this.modulesInternal.resetCacheKey()
  }

  onModuleChanged(moduleid: string): void {
    console.log('changed ' + moduleid)
    this.modulesInternal.set(moduleid, new ModuleInfo(this, moduleid))
  }

  onModuleDeleted(moduleid: string): void {
    this.modulesInternal.delete(moduleid)
    this.modulesInternal.resetCacheKey()
  }

  onImageCreated(name: string): void {
    this.imagesInternal.add(name)
    this.imagesInternal.resetCacheKey()
  }

  onImageChanged(name: string): void {}
  onImageDeleted(name: string): void {
    this.imagesInternal.delete(name)
    this.imagesInternal.resetCacheKey()
  }

  onCollectionCreated(filename: string): void {
    this.collectionsInternal.set(filename, new CollectionInfo(this, filename))
    this.collectionsInternal.resetCacheKey()
  }

  onCollectionChanged(filename: string): void {
    this.collectionsInternal.set(filename, new CollectionInfo(this, filename))
  }

  onCollectionDeleted(filename: string): void {
    this.collectionsInternal.delete(filename)
    this.collectionsInternal.resetCacheKey()
  }

  processChange(change: FileEvent): void {
    const itemPath = URI.parse(change.uri).fsPath
    const itemPathRelative = itemPath.replace(path.join(this.workspaceRoot(), '/'), '')
    const itemType = itemPathRelative.substring(0, itemPathRelative.indexOf('/'))
    if (itemType === 'collections') {
      const filename = itemPathRelative.replace(path.join(itemType, '/'), '')
      const func = {
        [FileChangeType.Created]: this.onCollectionCreated,
        [FileChangeType.Changed]: this.onCollectionChanged,
        [FileChangeType.Deleted]: this.onCollectionDeleted
      }[change.type].bind(this)
      func(filename)
      return
    } else if (itemType === 'modules') {
      const moduleid = itemPathRelative
        .replace(path.join(itemType, '/'), '')
        .replace(path.join('/', 'index.cnxml'), '')
      const func = {
        [FileChangeType.Created]: this.onModuleCreated,
        [FileChangeType.Changed]: this.onModuleChanged,
        [FileChangeType.Deleted]: this.onModuleDeleted
      }[change.type].bind(this)
      func(moduleid)
      return
    } else if (itemType === 'media') {
      const mediaFilename = itemPathRelative
        .replace(path.join(itemType, '/'), '')
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
