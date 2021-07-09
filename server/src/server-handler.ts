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
import { fixDocument } from './fix-document-ids'

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
    async function fixModule(moduleName: string): Promise<void> {
      // 3 steps necessary for element id creation: check, fix, save
      // == check xml ==
      // TODO: use cached book-bundle doc data in future for performance increase?
      const modulePath = path.join(bundle.moduleDirectory(), moduleName, 'index.cnxml')
      const data = await fs.promises.readFile(modulePath, { encoding: 'utf-8' })
      const doc = new DOMParser().parseFromString(data)
      // == fix xml ==
      fixDocument(doc)
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


fixDocument()