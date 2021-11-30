import { BundleEnsureIdsParams } from '../../common/src/requests'
import { fixModule } from './fix-document-ids'
import { bundleFactory } from './server'
import { ModelManager } from './model-manager'
import { CompletionItem, CompletionParams } from 'vscode-languageserver/node'

export function bundleEnsureIdsHandler(): (request: BundleEnsureIdsParams) => Promise<void> {
  return async (request: BundleEnsureIdsParams) => {
    const manager = bundleFactory.getOrAdd(request.workspaceUri)
    // TODO: fix modules in parallel. Problem: Could be a memory hog.
    const pages = manager.bundle.allPages.all.filter(p => p.exists && p.isLoaded)
    await Promise.all(pages.map(async p => await fixModule(p)))
  }
}

export async function resourceAutocompleteHandler(documentPosition: CompletionParams, manager: ModelManager): Promise<CompletionItem[]> {
  await manager.loadEnoughForOrphans()
  const cursor = documentPosition.position
  const page = manager.bundle.allPages.get(documentPosition.textDocument.uri)

  if (page !== undefined) {
    return manager.autocompleteResources(page, cursor)
  }
  return []
}
