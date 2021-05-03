
import { BookBundle, BundleItem } from './book-bundle'
import { BundleValidationQueue, collectionDiagnostic } from './bundle-validation'
import { Connection } from 'vscode-languageserver/node'
import { TocTreeCollection } from '../../common/src/toc-tree'
import {
  expect
} from './utils'
import {
  BundleTreesArgs,
  BundleModulesArgs,
  BundleTreesResponse,
  BundleOrphanedModulesArgs,
  BundleModulesResponse,
  BundleOrphanedModulesResponse
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
      } catch {
        const uri = expect(bundle.bundleItemToUri(collection), 'No root path to generate diagnostic')
        const diagnostics = expect(await collectionDiagnostic(), 'No diagnostic to generate')
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

export function bundleOrphanedModulesHandler(workspaceBookBundles: Map<string, [BookBundle, BundleValidationQueue]>): (request: BundleOrphanedModulesArgs) => Promise<BundleOrphanedModulesResponse> {
  return async (request: BundleOrphanedModulesArgs) => {
    const bundleAndValidator = workspaceBookBundles.get(request.workspaceUri)
    if (bundleAndValidator == null) { return null }
    const bundle = bundleAndValidator[0]
    const orphanModules = Array.from((await bundle.orphanedModules()).inner)
    const result = await Promise.all(orphanModules.map(async m => await bundle.moduleAsTreeObject(m)))
    return result
  }
}

export function bundleModulesHandler(workspaceBookBundles: Map<string, [BookBundle, BundleValidationQueue]>): (request: BundleModulesArgs) => Promise<BundleModulesResponse> {
  return async (request: BundleModulesArgs) => {
    const bundleAndValidator = workspaceBookBundles.get(request.workspaceUri)
    if (bundleAndValidator == null) { return null }
    const bundle = bundleAndValidator[0]
    const modules = bundle.modules()
    const result = await Promise.all(modules.map(async m => await bundle.moduleAsTreeObject(m)))
    return result
  }
}
