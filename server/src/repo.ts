import { DOMParser, XMLSerializer } from 'xmldom'
import path from 'path'
import fs from 'fs'
import { Diagnostic, FileChangeType, FileEvent } from 'vscode-languageserver/node'
import * as xpath from 'xpath-ts'
import { expect } from './utils'
import {
  URI
} from 'vscode-uri'

export const NS_COLLECTION = 'http://cnx.rice.edu/collxml'
export const NS_CNXML = 'http://cnx.rice.edu/cnxml'
export const NS_METADATA = 'http://cnx.rice.edu/mdml'

const select = xpath.useNamespaces({ cnxml: NS_CNXML, col: NS_COLLECTION, md: NS_METADATA })

export interface TocTreeModule {
  type: 'module'
  moduleid: string
  title: string
  subtitle?: string
}
export interface TocTreeCollection {
  type: 'collection' | 'subcollection'
  title: string
  slug?: string
  expanded?: boolean // Only only by dnd tree library
  children: TocTreeElement[]
}
export type TocTreeElement = TocTreeModule | TocTreeCollection

interface Link {
  moduleid: string
  targetid: string
}

interface IRepoValidator {
  validateModule: (moduleid: string) => Promise<Diagnostic[]>
  validateCollection: (slug: string) => Promise<Diagnostic[]>
}

type ArrayKeys = keyof any[];
type Indices<T> = Exclude<keyof T, ArrayKeys>;
type extractGeneric<Type> = Type extends CachedOrElse<infer X> ? X : never

class CachedOrElse<T> {
  static async from<U>(value: U | null, orElse: () => U | Promise<U>): Promise<CachedOrElse<U>> {
    if (value == null) {
      return new CachedOrElse(await orElse(), false)
    }
    return new CachedOrElse(value, true)
  }

  static async fromUncached<U>(orElse: () => U | Promise<U>): Promise<CachedOrElse<U>> {
    return new CachedOrElse(await orElse(), false)
  }

  static async withDependency<U, V>(value: U | null, orElse: (dep: V) => () => U | Promise<U>, dependency: CachedOrElse<V>): Promise<CachedOrElse<U>> {
    const innerOrElse = orElse(dependency.value)
    if (!dependency.cached) {
      return await CachedOrElse.fromUncached(innerOrElse)
    }
    return await CachedOrElse.from(value, innerOrElse)
  }

  private constructor(public value: T, public cached: boolean) {}
}

export class Repo {
  private orphanModulesInternal: Set<string> | null = null
  private orphanImagesInternal: Set<string> | null = null

  static async from(workspaceRoot: string) {
    const images = new Set<string>()
    const modules = new Map<string, ModuleInfo>()
    const collections = new Map<string, CollectionInfo>()
    const repo = new Repo(workspaceRoot, images, modules, collections)
    const loadImages = async (repo: Repo, set: Set<string>): Promise<void> => {
      const foundImages = await fs.promises.readdir(path.join(workspaceRoot, 'media'))
      for (const image of foundImages) {
        set.add(image)
      }
    }
    const loadModules = async (repo: Repo, map: Map<string, ModuleInfo>): Promise<void> => {
      const foundModules = await fs.promises.readdir(path.join(workspaceRoot, 'modules'))
      for (const module of foundModules) {
        map.set(module, new ModuleInfo(repo, module))
      }
    }
    const loadCollections = async (repo: Repo, map: Map<string, CollectionInfo>): Promise<void> => {
      const foundCollections = await fs.promises.readdir(path.join(workspaceRoot, 'collections'))
      for (const collection of foundCollections) {
        map.set(collection, new CollectionInfo(repo, collection))
      }
    }
    await Promise.all([loadImages(repo, images), loadModules(repo, modules), loadCollections(repo, collections)])
    return repo
  }

  constructor(
    private readonly workspaceRootInternal: string,
    private readonly imagesInternal: Set<string>,
    private readonly modulesInternal: Map<string, ModuleInfo>,
    private readonly collectionsInternal: Map<string, CollectionInfo>
  ) {}

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

  async _orphanImagesLoaded(): Promise<CachedOrElse<Set<string>>> {
    const usedImagesPerModule = await Promise.all(Array.from(this.modulesInternal.values()).map(async module => await module.imagesLoaded()))
    const cannotBeCached = usedImagesPerModule.some(result => !result.cached)
    const orElse = () => {
      const orphanImages = new Set(this.imagesInternal)
      for (const moduleImages of usedImagesPerModule) {
        for (const image of moduleImages.value) {
          orphanImages.delete(image)
        }
      }
      this.orphanImagesInternal = orphanImages
      return orphanImages
    }
    if (cannotBeCached) {
      return CachedOrElse.fromUncached(orElse)
    }
    return CachedOrElse.from(this.orphanImagesInternal, orElse)
  }

  async orphanImages(): Promise<string[]> {
    return Array.from((await this._orphanImagesLoaded()).value)
  }

  async _orphanModulesLoaded(): Promise<CachedOrElse<Set<string>>> {
    const usedModulesPerCollection = await Promise.all(Array.from(this.collectionsInternal.values()).map(async collection => await collection.modulesLoaded()))
    const cannotBeCached = usedModulesPerCollection.some(result => !result.cached)
    const orElse = () => {
      const orphanModules = new Set(this.modulesInternal.keys())
      for (const collectionModules of usedModulesPerCollection) {
        for (const module of collectionModules.value) {
          orphanModules.delete(module)
        }
      }
      this.orphanModulesInternal = orphanModules
      return orphanModules
    }
    if (cannotBeCached) {
      return CachedOrElse.fromUncached(orElse)
    }
    return CachedOrElse.from(this.orphanModulesInternal, orElse)
  }

  async orphanModules(): Promise<string[]> {
    return Array.from((await this._orphanModulesLoaded()).value)
  }

  async moduleTitle(moduleid: string): Promise<string | null> {
    const moduleInfo = this.modulesInternal.get(moduleid)
    if (moduleInfo == null) {
      return null
    }
    return (await moduleInfo.title()).value
  }

  async isIdInModule(id: string, moduleid: string): Promise<boolean> {
    const moduleInfo = this.modulesInternal.get(moduleid)
    if (moduleInfo == null) {
      return false
    }
    return (await moduleInfo.idsLoaded()).value.has(id)
  }

  async isIdUniqueInModule(id: string, moduleid: string): Promise<boolean> {
    const moduleInfo = this.modulesInternal.get(moduleid)
    if (moduleInfo == null) {
      return false
    }
    const elements = (await moduleInfo.idsLoaded()).value.get(id)
    if (elements == null) {
      return false
    }
    return elements.length === 1
  }

  async moduleLinks(moduleid: string): Promise<Link[]> {
    const moduleInfo = this.modulesInternal.get(moduleid)
    if (moduleInfo == null) {
      return []
    }
    return (await moduleInfo.linksLoaded()).value
  }

  async moduleImages(moduleid: string): Promise<string[]> {
    const moduleInfo = this.modulesInternal.get(moduleid)
    if (moduleInfo == null) {
      return []
    }
    return (await moduleInfo.imagesLoaded()).value
  }

  async collectionTree(filename: string): Promise<TocTreeCollection | null> {
    const collectionInfo = this.collectionsInternal.get(filename)
    if (collectionInfo == null) {
      return null
    }
    return (await collectionInfo.treeLoaded()).value
  }

  async moduleAsTreeObject(moduleid: string): Promise<TocTreeModule> {
    return {
      type: 'module',
      moduleid: moduleid,
      title: (await this.moduleTitle(moduleid)) ?? 'Unnamed Module',
      subtitle: moduleid
    }
  }

  onModuleCreated(moduleid: string): void {
    this.modulesInternal.set(moduleid, new ModuleInfo(this, moduleid))
    this.orphanModulesInternal = null
  }

  onModuleChanged(moduleid: string): void {
    console.log('changed ' + moduleid)
    this.modulesInternal.set(moduleid, new ModuleInfo(this, moduleid))
    this.orphanImagesInternal = null
    for (const info of this.collectionsInternal.values()) {
      info.removeTreeCache()
    }
  }

  onModuleDeleted(moduleid: string): void {
    this.modulesInternal.delete(moduleid)
    this.orphanImagesInternal = null
    this.orphanModulesInternal = null
  }

  onImageCreated(name: string): void {
    this.imagesInternal.add(name)
    this.orphanImagesInternal = null
  }

  onImageChanged(name: string): void {}
  onImageDeleted(name: string): void {
    this.imagesInternal.delete(name)
    this.orphanImagesInternal = null
  }

  onCollectionCreated(filename: string): void {
    this.collectionsInternal.set(filename, new CollectionInfo(this, filename))
  }

  onCollectionChanged(filename: string): void {
    this.collectionsInternal.set(filename, new CollectionInfo(this, filename))
    this.orphanModulesInternal = null
  }

  onCollectionDeleted(filename: string): void {
    this.collectionsInternal.delete(filename)
    this.orphanModulesInternal = null
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

class ModuleInfo {
  private readonly titleInternal: string | null = null
  private documentInternal: Document | null = null
  private idsInternal: Map<string, Element[]> | null = null
  private linksInternal: Link[] | null = null
  private imagesInternal: string[] | null = null

  constructor(private readonly repo: Repo, private readonly moduleid: string) {}
  async title(): Promise<CachedOrElse<string>> {
    const guess = (): string | null => {
      const modulePath = path.join(this.repo.workspaceRoot(), 'modules', this.moduleid, 'index.cnxml')
      const data = fs.readFileSync(modulePath, { encoding: 'utf-8' })
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
      return moduleTitle
    }
    const orElse = async (): Promise<string> => {
      const guessedTitle = guess()
      if (guessedTitle != null) {
        return guessedTitle
      }
      const document = (await this.documentLoaded()).value
      try {
        const metadata = document.getElementsByTagNameNS(NS_CNXML, 'metadata')[0]
        const moduleTitle = metadata.getElementsByTagNameNS(NS_METADATA, 'title')[0].textContent
        return moduleTitle ?? 'Unnamed Module'
      } catch {
        return 'Unnamed Module'
      }
    }
    return await CachedOrElse.from(this.titleInternal, orElse)
  }

  async documentLoaded(): Promise<CachedOrElse<Document>> {
    const orElse = async () => {
      const modulePath = path.join(this.repo.workspaceRoot(), 'modules', this.moduleid, 'index.cnxml')
      const data = fs.readFileSync(modulePath, { encoding: 'utf-8' })
      const document = new DOMParser().parseFromString(data)
      this.documentInternal = document
      return document
    }
    return await CachedOrElse.from(this.documentInternal, orElse)
  }

  async imagesLoaded(): Promise<CachedOrElse<string[]>> {
    return await CachedOrElse.withDependency(
      this.imagesInternal,
      (document: Document) => () => {
        const images = []
        const imageNodes = select('//cnxml:image[@src]', document) as Element[]
        for (const imageNode of imageNodes) {
          images.push(expect(imageNode.getAttribute('src'), 'selection requires attribute exists'))
        }
        this.imagesInternal = images
        return images
      },
      await this.documentLoaded()
    )
  }

  async idsLoaded(): Promise<CachedOrElse<Map<string, Element[]>>> {
    return await CachedOrElse.withDependency(
      this.idsInternal,
      (document: Document) => () => {
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
        this.idsInternal = ids
        return ids
      },
      await this.documentLoaded()
    )
  }

  async linksLoaded(): Promise<CachedOrElse<Link[]>> {
    return await CachedOrElse.withDependency(
      this.linksInternal,
      (document: Document) => () => {
        const links: Link[] = []
        const linkNodes = select('//cnxml:link[@target-id]', document) as Element[]
        for (const linkNode of linkNodes) {
          const documentid = linkNode.getAttribute('document') ?? this.moduleid
          links.push({
            moduleid: documentid,
            targetid: expect(linkNode.getAttribute('target-id'), 'selection requires attribute exists')
          })
        }
        this.linksInternal = links
        return links
      },
      await this.documentLoaded()
    )
  }
}

async function parseCollection(document: Document, moduleObjectResolver: (id: string) => Promise<TocTreeModule>): Promise<TocTreeCollection> {
  const metadata = document.getElementsByTagNameNS(NS_COLLECTION, 'metadata')[0]
  const collectionTitle = metadata.getElementsByTagNameNS(NS_METADATA, 'title')[0].textContent
  const collectionSlug = metadata.getElementsByTagNameNS(NS_METADATA, 'slug')[0].textContent

  const treeRoot = document.getElementsByTagNameNS(NS_COLLECTION, 'content')[0]

  const moduleToObject = async (element: any): Promise<TocTreeModule> => {
    const moduleid = element.getAttribute('document')
    return await moduleObjectResolver(expect(moduleid, 'Module ID missing'))
  }

  const subcollectionToObject = async (element: any): Promise<TocTreeCollection> => {
    const title = element.getElementsByTagNameNS(NS_METADATA, 'title')[0].textContent
    const content = element.getElementsByTagNameNS(NS_COLLECTION, 'content')[0]
    return {
      type: 'subcollection',
      title: expect(title, 'Subcollection title missing'),
      children: await childObjects(content)
    }
  }

  const childObjects = async (element: any): Promise<TocTreeElement[]> => {
    const children = []
    for (const child of Array.from<any>(element.childNodes)) {
      if (child.localName === 'module') {
        children.push(await moduleToObject(child))
      } else if (child.localName === 'subcollection') {
        children.push(await subcollectionToObject(child))
      }
    }
    return children
  }

  return {
    type: 'collection',
    title: expect(collectionTitle, 'Collection title missing'),
    slug: expect(collectionSlug, 'Collection slug missing'),
    children: await childObjects(treeRoot)
  }
}

class CollectionInfo {
  private documentInternal: Document | null = null
  private modulesInternal: string[] | null = null
  private treeInternal: TocTreeCollection | null = null

  constructor(private readonly repo: Repo, private readonly filename: string) {}
  async documentLoaded(): Promise<CachedOrElse<Document>> {
    const orElse = async () => {
      const modulePath = path.join(this.repo.workspaceRoot(), 'collections', this.filename)
      const data = fs.readFileSync(modulePath, { encoding: 'utf-8' })
      const document = new DOMParser().parseFromString(data)
      this.documentInternal = document
      return document
    }
    return await CachedOrElse.from(this.documentInternal, orElse)
  }

  async modulesLoaded(): Promise<CachedOrElse<string[]>> {
    return await CachedOrElse.withDependency(
      this.modulesInternal,
      (document: Document) => () => {
        const modules = []
        const moduleNodes = select('//col:module[@document]', document) as Element[]
        for (const moduleNode of moduleNodes) {
          modules.push(expect(moduleNode.getAttribute('document'), 'selection requires attribute exists'))
        }
        this.modulesInternal = modules
        return modules
      },
      await this.documentLoaded()
    )
  }

  async treeLoaded(): Promise<CachedOrElse<TocTreeCollection>> {
    return await CachedOrElse.withDependency(
      this.treeInternal,
      (document) => async () => {
        const tree = await parseCollection(document, this.repo.moduleAsTreeObject.bind(this.repo))
        this.treeInternal = tree
        return tree
      },
      await this.documentLoaded()
    )
  }
  removeTreeCache(): void {
    this.treeInternal = null
  }
}
