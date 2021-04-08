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
