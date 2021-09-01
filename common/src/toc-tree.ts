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
export interface TocTreeCollection {
  type: TocTreeElementType.collection | TocTreeElementType.subcollection
  title: string
  slug?: string
  expanded?: boolean // Only only by dnd tree library
  children: TocTreeElement[]
}
export type TocTreeElement = TocTreeModule | TocTreeCollection

export enum TocNodeKind {
  Inner,
  Leaf
}
export type TocNode<T> = TocInner<T> | TocLeaf<T>
export interface TocInner<T> { type: TocNodeKind.Inner, readonly title: string, readonly children: Array<TocNode<T>> }
export interface TocLeaf<T> { type: TocNodeKind.Leaf, readonly page: T }

export interface BookToc {
  readonly uuid: string
  readonly title: string
  readonly slug: string
  readonly language: string
  readonly licenseUrl: string
  readonly tree: Array<TocNode<string>>
}
