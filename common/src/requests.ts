import { TocTreeModule, BookToc, ClientPageish } from './toc-tree'

export enum DiagnosticSource {
  xml = 'xml',
  cnxml = 'cnxml'
}

export type Opt<T> = T | undefined

// Mock out the basic need of the LanguageClient for common,
// since we can't import the client lib.
interface LanguageClient {
  sendRequest: <R>(method: string, param: any) => Promise<R>
}

// The following are all shared between the client and the server
// to ensure that any requests between the two are type-safe.
// It is discouraged to have any usage of `client.sendRequest`
// outside this file, or any request handler in the server that
// does not utilize one of the ExtensionServerRequest types

export enum ExtensionServerRequest {
  BundleModules = 'bundle-modules',
  BundleOrphanedModules = 'bundle-orphaned-modules',
  BundleEnsureIds = 'bundle-ensure-ids',
  TocModification = 'toc-modification',
  NewPage = 'new-page',
  NewSubbook = 'new-subbook'
}

export enum ExtensionServerNotification {
  BookTocs = 'book-tocs',
  AllPages = 'all-pages',
  // OrphanPages = 'orphan-pages',
  // OrphanImages = 'orphan-images',
}

export interface BooksAndOrphans {
  books: BookToc[]
  orphans: ClientPageish[]
}

export type BookTocsArgs = BooksAndOrphans & { version: number }

export const DEFAULT_BOOK_TOCS_ARGS: BookTocsArgs = { version: -1, books: [], orphans: [] }

export interface BundleTreesArgs {
  workspaceUri: string
}

export interface NewPageParams {
  workspaceUri: string
  title: string
  bookIndex: number
}

export interface NewSubbookParams {
  workspaceUri: string
  title: string
  bookIndex: number
  slug: string
}

export interface BundleOrphanedModulesArgs {
  workspaceUri: string
}
export type BundleOrphanedModulesResponse = TocTreeModule[] | null

export interface BundleModulesArgs {
  workspaceUri: string
}
export type BundleModulesResponse = TocTreeModule[] | null
export interface BundleEnsureIdsArgs {
  workspaceUri: string
}

export const requestBundleOrphanedModules = async (client: LanguageClient, args: BundleOrphanedModulesArgs): Promise<BundleOrphanedModulesResponse> => {
  return await client.sendRequest(ExtensionServerRequest.BundleOrphanedModules, args)
}
export const requestBundleModules = async (client: LanguageClient, args: BundleModulesArgs): Promise<BundleModulesResponse> => {
  return await client.sendRequest(ExtensionServerRequest.BundleModules, args)
}
export const requestEnsureIds = async (client: LanguageClient, args: BundleEnsureIdsArgs): Promise<void> => {
  return await client.sendRequest(ExtensionServerRequest.BundleEnsureIds, args)
}
