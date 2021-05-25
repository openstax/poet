import { TocTreeModule, TocTreeCollection } from './toc-tree'

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
  BundleTrees = 'bundle-trees',
  BundleModules = 'bundle-modules',
  BundleOrphanedModules = 'bundle-orphaned-modules'
}
export interface BundleTreesArgs {
  workspaceUri: string
}
export type BundleTreesResponse = TocTreeCollection[] | null

export interface BundleOrphanedModulesArgs {
  workspaceUri: string
}
export type BundleOrphanedModulesResponse = TocTreeModule[] | null

export interface BundleModulesArgs {
  workspaceUri: string
}
export type BundleModulesResponse = TocTreeModule[] | null

export const requestBundleTrees = async (client: LanguageClient, args: BundleTreesArgs): Promise<BundleTreesResponse> => {
  return await client.sendRequest(ExtensionServerRequest.BundleTrees, args)
}
export const requestBundleOrphanedModules = async (client: LanguageClient, args: BundleOrphanedModulesArgs): Promise<BundleOrphanedModulesResponse> => {
  return await client.sendRequest(ExtensionServerRequest.BundleOrphanedModules, args)
}
export const requestBundleModules = async (client: LanguageClient, args: BundleModulesArgs): Promise<BundleModulesResponse> => {
  return await client.sendRequest(ExtensionServerRequest.BundleModules, args)
}
