import fs from 'node:fs'

import type { BundleGenerateReadmeParams, BundleEnsureIdsParams, BundleGetSubmoduleConfigParams } from '../../common/src/requests'
import { idFixer } from './fix-document-ids'
import { bundleFactory } from './server'
import { type ModelManager } from './model-manager'
import { type CompletionItem, type CompletionParams } from 'vscode-languageserver/node'
import { PageValidationKind } from './model/page'
import { generateReadmeForWorkspace } from './readme-generator'
import { URI } from 'vscode-uri'
import { parseGitConfig } from './git-config-parser'

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

export function bundleGenerateReadme(): (request: BundleGenerateReadmeParams) => Promise<void> {
  return async (request: BundleGenerateReadmeParams) => {
    const manager = bundleFactory.getOrAdd(request.workspaceUri)
    const books = manager.bundle.books
    const readmePath = `${URI.parse(request.workspaceUri).fsPath}/README.md`
    if (!books.every(b => b.exists && b.isLoaded)) {
      throw new Error('Wait longer for books to load')
    }
    // toArray because I.Set uses non-standard iterators
    fs.writeFileSync(readmePath, generateReadmeForWorkspace(books.toArray()))
  }
}

export function bundleGetSubmoduleConfig(): (request: BundleGetSubmoduleConfigParams) => Promise<Record<string, string> | null> {
  return async (request: BundleGetSubmoduleConfigParams) => {
    const gitmodules = `${URI.parse(request.workspaceUri).fsPath}/.gitmodules`
    return fs.existsSync(gitmodules)
      ? parseGitConfig(fs.readFileSync(gitmodules, 'utf-8'))
      : null
  }
}

export async function autocompleteHandler(documentPosition: CompletionParams, manager: ModelManager): Promise<CompletionItem[]> {
  const cursor = documentPosition.position
  const page = manager.bundle.allPages.get(documentPosition.textDocument.uri)

  if (page !== undefined && page.exists) {
    return (await Promise.all([
      manager.autocompleteResources(page, cursor),
      manager.autocompleteUrls(page, cursor)
    ])).flat()
  }
  return []
}
