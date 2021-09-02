import { BundleEnsureIdsArgs } from '../../common/src/requests'
import { fixModule } from './fix-document-ids'
import { bundleFactory } from './server'
import { ModelManager } from './model-manager'
import { CompletionItem, CompletionParams } from 'vscode-languageserver/node'

export function bundleEnsureIdsHandler(): (request: BundleEnsureIdsArgs) => Promise<void> {
  return async (request: BundleEnsureIdsArgs) => {
    const manager = bundleFactory.getOrAdd(request.workspaceUri)
    // TODO: fix modules in parallel. Problem: Could be a memory hog.
    const pages = manager.bundle.allPages.all.filter(p => p.exists && p.isLoaded)
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
