export interface TocTreeModule {
  type: 'module'
  moduleid: string
  title: string
  subtitle?: string
}
export interface TocTreeCollection {
  type: 'collection' | 'subcollection'
  title: string
  slug?: string
  expanded?: boolean // Only only by dnd tree library
  children: TocTreeElement[]
}
export type TocTreeElement = TocTreeModule | TocTreeCollection
