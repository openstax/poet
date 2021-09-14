import xmlFormat from 'xml-formatter'
import { DOMParser, XMLSerializer } from 'xmldom'
import { BookRootNode, BookToc, ClientPageish, ClientTocNode, TocLeaf } from '../../common/src/toc-tree'
import { pageToModuleId } from './model-manager'
import { BookNode, TocInnerWithRange, TocNodeWithRange } from './model/book'
import { PageNode } from './model/page'
import { selectOne, NS_COLLECTION, NS_METADATA, TocNodeKind, equalsArray } from './model/utils'

export const equalsTocNode = (n1: ClientTocNode, n2: ClientTocNode): boolean => {
  /* istanbul ignore else */
  if (n1.type === TocNodeKind.Inner) {
    /* istanbul ignore next */
    if (n2.type !== n1.type) return false
    /* istanbul ignore next */
    return n1.value === n2.value && equalsTocNodeArray(n1.children, n2.children)
  } else {
    /* istanbul ignore next */
    if (n2.type !== n1.type) return false
    /* istanbul ignore next */
    return n1.value === n2.value
  }
}
export const equalsTocNodeArray = equalsArray(equalsTocNode)

export const equalsClientPageish = (n1: ClientPageish, n2: ClientPageish): boolean => {
  /* istanbul ignore if */
  if (n1.token !== n2.token) return false
  /* istanbul ignore if */
  if (n1.title !== n2.title) return false
  /* istanbul ignore if */
  if (n1.absPath !== n2.absPath) return false
  return true
}
export const equalsClientPageishArray = equalsArray(equalsClientPageish)

export const equalsBookToc = (n1: BookToc, n2: BookToc): boolean => {
  /* istanbul ignore if */
  if (n1.uuid !== n2.uuid) return false
  /* istanbul ignore if */
  if (n1.title !== n2.title) return false
  /* istanbul ignore if */
  if (n1.slug !== n2.slug) return false
  /* istanbul ignore if */
  if (n1.licenseUrl !== n2.licenseUrl) return false
  return equalsArray(equalsTocNode)(n1.tree, n2.tree)
}

const BOOK_XML_TEMPLATE = `<col:collection xmlns:col="http://cnx.rice.edu/collxml" xmlns:md="http://cnx.rice.edu/mdml" xmlns="http://cnx.rice.edu/collxml">
<col:metadata>
  <md:title/>
  <md:slug/>
  <md:language/>
  <md:uuid/>
  <md:license/>
</col:metadata>
<col:content/>
</col:collection>`

export function fromBook(tocIdMap: IdMap<string, TocInnerWithRange|PageNode>, book: BookNode): BookToc {
  return {
    type: BookRootNode.Singleton,
    absPath: book.absPath,
    uuid: book.uuid,
    title: book.title,
    slug: book.slug,
    language: book.language,
    licenseUrl: book.licenseUrl,
    tree: book.toc.map(t => recTree(tocIdMap, null, t))
  }
}

export function toString(t: BookToc) {
  const doc = new DOMParser().parseFromString(BOOK_XML_TEMPLATE)

  selectOne('/col:collection/col:metadata/md:title', doc).textContent = t.title
  selectOne('/col:collection/col:metadata/md:slug', doc).textContent = t.slug
  selectOne('/col:collection/col:metadata/md:language', doc).textContent = t.language
  selectOne('/col:collection/col:metadata/md:uuid', doc).textContent = t.uuid
  const license = selectOne('/col:collection/col:metadata/md:license', doc)
  license.setAttribute('url', t.licenseUrl)

  const treeRoot = selectOne('/col:collection/col:content', doc)
  t.tree.forEach(t => treeRoot.appendChild(recBuild(doc, t)))

  const serailizedXml = xmlFormat(new XMLSerializer().serializeToString(doc), {
    indentation: '  ',
    collapseContent: true,
    lineSeparator: '\n'
  })
  return serailizedXml
}

export function fromPage(tocIdMap: IdMap<string, TocInnerWithRange|PageNode>, n: PageNode): TocLeaf<ClientPageish> {
  return { type: TocNodeKind.Leaf, value: { token: tocIdMap.add(n), title: n.optTitle, absPath: n.absPath, fileId: pageToModuleId(n) } }
}
function recTree(tocIdMap: IdMap<string, TocInnerWithRange|PageNode>, parent: TocInnerWithRange|null, n: TocNodeWithRange): ClientTocNode {
  if (n.type === TocNodeKind.Leaf) {
    return fromPage(tocIdMap, n.page)
  } else {
    return { ...n, value: { token: tocIdMap.add(n), title: n.title }, children: n.children.map(c => recTree(tocIdMap, n, c)) }
  }
}

function recBuild(doc: Document, node: ClientTocNode): Element {
  if (node.type === TocNodeKind.Leaf) {
    const ret = doc.createElementNS(NS_COLLECTION, 'col:module')
    ret.setAttribute('document', node.value.fileId)
    return ret
  } else {
    const ret = doc.createElementNS(NS_COLLECTION, 'col:subcollection')
    const title = doc.createElementNS(NS_METADATA, 'md:title')
    const content = doc.createElementNS(NS_COLLECTION, 'col:content')
    title.textContent = node.value.title
    node.children.forEach(c => content.appendChild(recBuild(doc, c)))
    ret.appendChild(title)
    ret.appendChild(content)
    return ret
  }
}

// A Bi-Directional 1-1 Map. Each Key corresponds to exactly one value and each value corresponds to exactly one key
export class IdMap<K, V> {
  private readonly map1 = new Map<K, V>()
  private readonly map2 = new Map<V, K>()
  constructor(private readonly idGenerator: (v: V) => K) {}
  // clear() {
  //   this.map1.clear()
  //   this.map2.clear()
  // }

  add(v: V) {
    const k = this.map2.get(v)
    /* istanbul ignore if */
    if (k !== undefined) {
      return k
    } else {
      const k = this.idGenerator(v)
      this.map1.set(k, v)
      this.map2.set(v, k)
      return k
    }
  }

  // hasKey(k: K) { return this.map1.has(k) }
  // hasValue(v: V) { return this.map2.has(v) }
  // getValue(k: K) { return this.map1.get(k) }
  // getKey(v: V) { return this.map2.get(v) }
}

export function renameTitle(newTitle: string, cnxmlStr: string) {
  const doc = new DOMParser().parseFromString(cnxmlStr)
  selectOne('/cnxml:document/cnxml:title', doc).textContent = newTitle

  return new XMLSerializer().serializeToString(doc)
}
