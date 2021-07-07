
import { BookBundle, BundleItem } from './book-bundle'
import { BundleValidationQueue, collectionDiagnostic } from './bundle-validation'
import { Connection } from 'vscode-languageserver/node'
import { TocTreeCollection } from '../../common/src/toc-tree'
import {
  expect
} from './utils'
import {
  BundleTreesArgs,
  BundleTreesResponse
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
