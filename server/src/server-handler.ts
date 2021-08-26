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
import {
  CompletionItem,
  CompletionItemKind,
  Range,
  TextDocumentPositionParams,
  TextEdit
} from 'vscode-languageserver/node'
import { expectValue, inRange } from './model/utils'
import path from 'path'

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

export async function imageAutocompleteHandler(connection: any, documentPosition: TextDocumentPositionParams, manager: ModelManager): Promise<CompletionItem[]|null> {
  await manager.loadEnoughForOrphans()
  const cursor = documentPosition.position
  const page = manager.bundle.allPages.get(documentPosition.textDocument.uri)

  if (page !== undefined) {
    const foundLinks = page.imageLinks.toArray().filter((l) => {
      return inRange(l.range, cursor)
    })

    if (foundLinks.length === 0) { return null }

    // We're inside an <image> element.
    // Now check and see if we are right at the src=" point
    const content = expectValue(manager.getOpenDocContents(page.absPath), 'BUG: This file should exist').split('\n')
    // const triggerChar = content[cursor.line][cursor.character-1]
    // if (triggerChar === '.') {
    const beforeCursor = content[cursor.line].substring(0, cursor.character)
    const afterCursor = content[cursor.line].substring(cursor.character)
    const startQuoteOffset = beforeCursor.lastIndexOf('src="')
    const endQuoteOffset = afterCursor.indexOf('"')
    if (startQuoteOffset >= 0 && endQuoteOffset >= 0) {
      const range: Range = {
        start: { line: cursor.line, character: startQuoteOffset + 'src="'.length },
        end: { line: cursor.line, character: endQuoteOffset + cursor.character }
      }
      expectValue(inRange(range, cursor) ? true : undefined, 'BUG: The cursor must be within the replacement range')
      const tokens = beforeCursor.split(' ')
      if (tokens[tokens.length - 1].startsWith('src="')) {
        const ret = manager.orphanedImages.toArray().map(i => {
          const insertText = path.relative(path.dirname(page.absPath), i.absPath)
          // const item = CompletionItem.create(`.../${path.basename(i.absPath)}`) // we need the dot at the beginning because it is the trigger character
          const item = CompletionItem.create(insertText)
          item.textEdit = TextEdit.replace(range, insertText)
          item.kind = CompletionItemKind.File
          item.detail = 'Orphaned Image'
          return item
        })
        return ret
      }
    }
    // }
  }

  return []
}
