import fs from 'fs'
import { DOMParser, XMLSerializer } from 'xmldom'
import {
  BundleTreesArgs,
  BundleTreesResponse,
  BundleEnsureIdsArgs
} from '../../common/src/requests'
import { fixDocument } from './fix-document-ids'
import { bundleFactory } from './server'
import { bookTocAsTreeCollection, ModelManager } from './model-manager'
import { PageNode } from './model/page'
import { CompletionItem, CompletionParams } from 'vscode-languageserver/node'

export function bundleTreesHandler(): (request: BundleTreesArgs) => Promise<BundleTreesResponse> {
  return async (request: BundleTreesArgs) => {
    const manager = bundleFactory.getOrAdd(request.workspaceUri)
    await manager.loadEnoughForToc() // Just enough to send the ToC and list orphans
    return manager.bundle.books.map(bookTocAsTreeCollection).toArray()
  }
}

export function bundleEnsureIdsHandler(): (request: BundleEnsureIdsArgs) => Promise<void> {
  return async (request: BundleEnsureIdsArgs) => {
    async function fixModule(p: PageNode): Promise<void> {
      // 3 steps necessary for element id creation: check, fix, save
      // == check xml ==
      // TODO: use cached book-bundle doc data in future for performance increase?
      const data = await fs.promises.readFile(p.absPath, { encoding: 'utf-8' })
      const doc = new DOMParser().parseFromString(data)
      // == fix xml ==
      fixDocument(doc)
      // == save xml ==
      const out = new XMLSerializer().serializeToString(doc)
      await fs.promises.writeFile(p.absPath, out, { encoding: 'utf-8' })
    }

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
