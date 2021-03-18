import { TocTreeModule, TocTreeCollection } from './toc-tree'

export enum ExtensionServerRequest {
  BundleTrees = 'bundle-trees',
  BundleModules = 'bundle-modules',
  BundleOrphanedModules = 'bundle-orphaned-moduled'
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
