import fs from 'node:fs'

import { BundleGenerateReadme, BundleEnsureIdsParams } from '../../common/src/requests'
import { idFixer } from './fix-document-ids'
import { bundleFactory } from './server'
import { ModelManager } from './model-manager'
import { CompletionItem, CompletionParams } from 'vscode-languageserver/node'
import { PageValidationKind } from './model/page'
import { generateReadmeForWorkspace } from './readme-generator'
import { URI } from 'vscode-uri'

export function bundleEnsureIdsHandler(): (request: BundleEnsureIdsParams) => Promise<void> {
  return async (request: BundleEnsureIdsParams) => {
    const manager = bundleFactory.getOrAdd(request.workspaceUri)
    // TODO: fix modules in parallel. Problem: Could be a memory hog.
    const pages = manager.bundle.allPages.all.filter(p => p.exists && p.isLoaded)
    const pagesWithMissingIds = pages.filter(p => {
      const errorTypes = p.validationErrors.errors.map(e => e.title)
      return errorTypes.has(PageValidationKind.MISSING_ID.title)
    })
    await Promise.all(pagesWithMissingIds.map(async p => await manager.modifyFileish(p, idFixer)))
  }
}

export function bundleGenerateReadme(): (request: BundleGenerateReadme) => Promise<void> {
  return async (request: BundleEnsureIdsParams) => {
    const manager = bundleFactory.getOrAdd(request.workspaceUri)
    const books = manager.bundle.allBooks.all
    const readmePath = `${URI.parse(request.workspaceUri).fsPath}/README.md`
    if (!books.every(b => b.exists && b.isLoaded)) {
      throw new Error('Wait longer for books to load')
    }
    // toArray because I.Set uses non-standard iterators
    fs.writeFileSync(readmePath, generateReadmeForWorkspace(books.toArray()))
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
