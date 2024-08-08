/* istanbul ignore file */
export enum TocNodeKind {
  Subbook = 'TocNodeKind.Subbook',
  Page = 'TocNodeKind.Page',
  Ancillary = 'TocNodeKind.Ancillary'
}

export enum BookRootNode {
  Singleton = 'BookRootNode.Singleton'
}

export enum TocModificationKind {
  Add = 'TocModificationKind.Add',
  Move = 'TocModificationKind.Move',
  Remove = 'TocModificationKind.Remove',
  PageRename = 'TocModificationKind.PageRename',
  SubbookRename = 'TocModificationKind.SubbookRename',
  AncillaryRename = 'TocModificationKind.AncillaryRename'
}

type TocNode<I, L> = TocSubbook<I, L> | TocPage<L> | TocAncillary<L>
export interface TocSubbook<I, L> { readonly type: TocNodeKind.Subbook, children: Array<TocNode<I, L>>, value: I }
export interface TocPage<L> { readonly type: TocNodeKind.Page, value: L }
export interface TocAncillary<L> { readonly type: TocNodeKind.Ancillary, value: L }

export type Token = string
export interface ClientPageish { token: Token, title: string | undefined, fileId: string, absPath: string }
export interface ClientAncillaryish { token: Token, title: string | undefined, fileId: string, absPath: string }
export interface ClientSubbookish { token: Token, title: string }
export type ClientTocNode = TocNode<ClientSubbookish, (ClientPageish | ClientAncillaryish)>

export interface BookToc {
  readonly type: BookRootNode.Singleton
  readonly absPath: string
  readonly uuid: string
  readonly title: string
  readonly slug: string
  readonly language: string
  readonly licenseUrl: string
  tocTree: ClientTocNode[]
}

export interface TocModificationParams {
  workspaceUri: string
  event: TocModification | CreateSubbookEvent | CreatePageEvent | CreateAncillaryEvent
}
export type TocModification = (TocMoveEvent | TocRemoveEvent | PageRenameEvent | SubbookRenameEvent | AncillaryRenameEvent)
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

export interface AncillaryRenameEvent {
  readonly type: TocModificationKind.AncillaryRename
  readonly newTitle: string
  readonly nodeToken: Token
  readonly bookIndex: number
}

export interface CreateSubbookEvent {
  readonly type: TocNodeKind.Subbook
  readonly title: string
  readonly slug: string | undefined
  readonly bookIndex: number
  readonly parentNodeToken: Token | undefined
}

export interface CreateAncillaryEvent {
  readonly type: TocNodeKind.Ancillary
  readonly title: string
  readonly bookIndex: number
  readonly parentNodeToken: Token | undefined
}

export interface CreatePageEvent {
  readonly type: TocNodeKind.Page
  readonly title: string
  readonly bookIndex: number
  readonly parentNodeToken: Token | undefined
}
