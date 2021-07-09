import * as xpath from 'xpath-ts'
import path from 'path'
import fs from 'fs'
import { DOMParser, XMLSerializer } from 'xmldom'
import { BookBundle, BundleItem } from './book-bundle'
import { BundleValidationQueue, collectionDiagnostic } from './bundle-validation'
import { Connection } from 'vscode-languageserver/node'
import { TocTreeCollection } from '../../common/src/toc-tree'
import {
  expect
} from './utils'
import {
  BundleTreesArgs,
  BundleTreesResponse,
  BundleEnsureIdsArgs
} from '../../common/src/requests'

export function bundleTreesHandler(workspaceBookBundles: Map<string, [BookBundle, BundleValidationQueue]>, connection: Connection): (request: BundleTreesArgs) => Promise<BundleTreesResponse> {
  return async (request: BundleTreesArgs) => {
    const bundleAndValidator = workspaceBookBundles.get(request.workspaceUri)
    if (bundleAndValidator == null) { return null }
    const bundle = bundleAndValidator[0]
    const promises = bundle.collectionItems().map(async (collection: BundleItem): Promise<TocTreeCollection[]> => {
      try {
        const tree = expect(await bundle.collectionTree(collection.key), 'collection must exist').inner
        return [tree]
      } catch (_error) {
        const error: Error = _error
        connection.console.error(`An error occurred while processing bundle tree: ${error.stack ?? error.message}`)
        const uri = expect(bundle.bundleItemToUri(collection), 'No root path to generate diagnostic')
        const diagnostics = await collectionDiagnostic()
        connection.sendDiagnostics({
          uri,
          diagnostics
        })
        return []
      }
    })
    const trees = (await Promise.all(promises)).flat()
    return trees
  }
}

export function bundleEnsureIdsHandler(workspaceBookBundles: Map<string, [BookBundle, BundleValidationQueue]>, connection: Connection): (request: BundleEnsureIdsArgs) => Promise<void> {
  return async (request: BundleEnsureIdsArgs) => {
    const NS_COLLECTION = 'http://cnx.rice.edu/collxml'
    const NS_CNXML = 'http://cnx.rice.edu/cnxml'
    const NS_METADATA = 'http://cnx.rice.edu/mdml'
    const select = xpath.useNamespaces({ cnxml: NS_CNXML, col: NS_COLLECTION, md: NS_METADATA })

    function padLeft(text: string, padChar: string, size: number): string {
      return (String(padChar).repeat(size) + text).substr((size * -1), size)
    }

    function needFixes(doc: Document): boolean {
      const needFixNodes = select('//cnxml:para[not(@id)]|//cnxml:equation[not(@id)]|//cnxml:list[not(@id)]|//cnxml:item[not(@id)]|//cnxml:section[not(@id)]|//cnxml:problem[not(@id)]|//cnxml:solution[not(@id)]|//cnxml:exercise[not(@id)]|//cnxml:example[not(@id)]|//cnxml:figure[not(@id)]|//cnxml:definition[not(@id)]|//cnxml:term[not(@id)]|//cnxml:meaning[not(@id)]|//cnxml:table[not(@id)]|//cnxml:quote[not(@id)]|//cnxml:note[not(@id)]|//cnxml:footnote[not(@id)]|//cnxml:cite[not(@id)]', doc) as Element[]
      return (needFixNodes.length > 0)
    }

    function buildNewIdAttribute(prefixId: string, id: number): string {
      const result = prefixId + padLeft(String(id), '0', 5)
      return result
    }

    function isIdAttributeExisting(doc: Document, tag: string, prefixId: string, id: number): boolean {
      const newId = buildNewIdAttribute(prefixId, id)
      const checkElements = select('//cnxml:' + tag + '[@id = "' + newId + '"]', doc) as Element[]
      return (checkElements.length > 0)
    }

    function fixIds(doc: Document, tag: string, prefixId: string): void {
      const fixNodes = select('//cnxml:' + tag + '[not(@id)]', doc) as Element[]
      for (const fixNode of fixNodes) {
        let newId: number = 1
        while (isIdAttributeExisting(doc, tag, prefixId, newId)) {
          newId++
        }
        const newIdAttribute = buildNewIdAttribute(prefixId, newId)
        fixNode.setAttribute('id', newIdAttribute)
      }
    }

    async function fixModule(moduleName: string): Promise<void> {
      // 3 steps necessary for element id creation: check, fix, save
      // == check xml ==
      // TODO: use cached book-bundle doc data in future for performance increase?
      const modulePath = path.join(bundle.moduleDirectory(), moduleName, 'index.cnxml')
      const data = await fs.promises.readFile(modulePath, { encoding: 'utf-8' })
      const doc = new DOMParser().parseFromString(data)
      // == fix xml ==
      if (needFixes(doc)) {
        fixIds(doc, 'para', 'para')
        fixIds(doc, 'equation', 'eq')
        fixIds(doc, 'list', 'list')
        fixIds(doc, 'item', 'item')
        fixIds(doc, 'section', 'sect')
        fixIds(doc, 'problem', 'prob')
        fixIds(doc, 'solution', 'sol')
        fixIds(doc, 'exercise', 'exer')
        fixIds(doc, 'example', 'exam')
        fixIds(doc, 'figure', 'fig')
        fixIds(doc, 'definition', 'def')
        fixIds(doc, 'term', 'term')
        fixIds(doc, 'meaning', 'mean')
        fixIds(doc, 'table', 'table')
        fixIds(doc, 'quote', 'quote')
        fixIds(doc, 'note', 'note')
        fixIds(doc, 'footnote', 'foot')
        fixIds(doc, 'cite', 'cite')
      }
      // == save xml ==
      const out = new XMLSerializer().serializeToString(doc)
      await fs.promises.writeFile(modulePath, out, { encoding: 'utf-8' })
    }

    const bundleAndValidator = workspaceBookBundles.get(request.workspaceUri)
    // TODO: rework return value on failing?
    if (bundleAndValidator == null) { return undefined }
    const bundle = bundleAndValidator[0]
    const modules = bundle.modules()
    const orphanModules = Array.from((await bundle.orphanedModules()).inner)
    const allModules = modules.concat(orphanModules)
    // TODO: fix modules in parallel. Problem: Could be a memory hog.
    for (const moduleName of allModules) {
      await fixModule(moduleName)
    }
  }
}
