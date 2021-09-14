export enum TocTreeElementType {
  collection = 'collection',
  subcollection = 'subcollection',
  module = 'module'
}
export interface TocTreeModule {
  type: TocTreeElementType.module
  moduleid: string
  title: string
  subtitle?: string
}

export enum TocNodeKind {
  Inner = 'TocNodeKind.Inner',
  Leaf = 'TocNodeKind.Leaf'
}
export type TocNode<I, L> = TocInner<I, L> | TocLeaf<L>
export interface TocInner<I, L> { readonly type: TocNodeKind.Inner, children: Array<TocNode<I, L>>, value: I }
export interface TocLeaf<L> { readonly type: TocNodeKind.Leaf, value: L }

export type Token = string
export interface ClientPageish {token: Token, title: string|undefined, fileId: string, absPath: string}
export interface ClientSubBookish {token: Token, title: string}
export type ClientTocNode = TocNode<ClientSubBookish, ClientPageish>

export enum BookRootNode {
  Singleton = 'BookRootNode.Singleton'
}
export interface BookToc {
  readonly type: BookRootNode.Singleton
  readonly absPath: string
  readonly uuid: string
  readonly title: string
  readonly slug: string
  readonly language: string
  readonly licenseUrl: string
  tree: ClientTocNode[]
}

export enum TocModificationKind {
  Move = 'TocModificationKind.Move',
  Remove = 'TocModificationKind.Remove',
  PageRename = 'TocModificationKind.PageRename',
  SubbookRename = 'TocModificationKind.SubbookRename',
}
export interface TocModificationParams {
  event: TocModification
  workspaceUri: string
}
export type TocModification = (TocMoveEvent | TocRemoveEvent | PageRenameEvent | SubbookRenameEvent)
export interface TocMoveEvent {
  readonly type: TocModificationKind.Move
  readonly nodeToken: Token
  readonly newParentToken: Token | undefined // when undefined the newChildIndex is for the top-level BookToc items
  readonly newChildIndex: number
  readonly bookIndex: number
}
export interface TocRemoveEvent {
  readonly type: TocModificationKind.Remove
  readonly nodeToken: Token
  readonly bookIndex: number
}

export interface PageRenameEvent {
  readonly type: TocModificationKind.PageRename
  readonly newTitle: string
  readonly nodeToken: Token
  readonly bookIndex: number
}
export interface SubbookRenameEvent {
  readonly type: TocModificationKind.SubbookRename
  readonly newTitle: string
  readonly nodeToken: Token
  readonly bookIndex: number
}
