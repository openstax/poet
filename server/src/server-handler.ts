import {
  BundleTreesArgs,
  BundleTreesResponse,
  BundleEnsureIdsArgs
} from '../../common/src/requests'
import { bundleFactory } from './server'
import { bookTocAsTreeCollection, ModelManager } from './model-manager'
import { CompletionItem, CompletionParams } from 'vscode-languageserver/node'
import { fixModule } from './fix-document-ids'

export function bundleTreesHandler(): (request: BundleTreesArgs) => Promise<BundleTreesResponse> {
  return async (request: BundleTreesArgs) => {
    const manager = bundleFactory.getOrAdd(request.workspaceUri)
    await manager.loadEnoughForToc() // Just enough to send the ToC and list orphans
    return manager.bundle.books.map(bookTocAsTreeCollection).toArray()
  }
}

export function bundleEnsureIdsHandler(): (request: BundleEnsureIdsArgs) => Promise<void> {
  return async (request: BundleEnsureIdsArgs) => {
    const manager = bundleFactory.getOrAdd(request.workspaceUri)
    // TODO: fix modules in parallel. Problem: Could be a memory hog.
    const pages = manager.bundle.allPages.all
    await Promise.all(pages.map(async p => await fixModule(p)))
  }
}

export async function imageAutocompleteHandler(documentPosition: CompletionParams, manager: ModelManager): Promise<CompletionItem[]> {
  await manager.loadEnoughForOrphans()
  const cursor = documentPosition.position
  const page = manager.bundle.allPages.get(documentPosition.textDocument.uri)

  if (page !== undefined) {
    return manager.autocompleteImages(page, cursor)
  }
  return []
}
