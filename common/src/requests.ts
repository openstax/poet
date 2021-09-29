import { BookToc, ClientPageish } from './toc'

export enum DiagnosticSource {
  xml = 'xml',
  cnxml = 'cnxml'
}

export type Opt<T> = T | undefined

// The following are all shared between the client and the server
// to ensure that any requests between the two are type-safe.
// It is discouraged to have any usage of `client.sendRequest`
// outside this file, or any request handler in the server that
// does not utilize one of the ExtensionServerRequest types

export enum ExtensionServerRequest {
  BundleEnsureIds = 'BUNDLE_ENSURE_IDS',
  TocModification = 'TOC_MODIFICATION'
}

export enum ExtensionServerNotification {
  BookTocs = 'BOOK_TOCS',
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

export interface BooksAndOrphans {
  books: BookToc[]
  orphans: ClientPageish[]
}

export const EMPTY_BOOKS_AND_ORPHANS: BooksAndOrphans = { books: [], orphans: [] }

// Mock out the basic need of the LanguageClient for common,
// since we can't import the client lib.
interface LanguageClient {
  sendRequest: <R>(method: string, param: any) => Promise<R>
}

export interface BundleEnsureIdsParams {
  workspaceUri: string
}

export const requestEnsureIds = async (client: LanguageClient, args: BundleEnsureIdsParams): Promise<void> => {
  return await client.sendRequest(ExtensionServerRequest.BundleEnsureIds, args)
}
