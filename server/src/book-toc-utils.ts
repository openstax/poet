import { DOMParser, XMLSerializer } from 'xmldom'
import { BookToc } from '../../common/src/toc-tree'
import { BookNode, TocNodeWithRange } from './model/book'
import { selectOne, NS_COLLECTION, NS_METADATA, TocNode, TocNodeKind, equalsArray } from './model/utils'

const equalsTocNode = (n1: TocNode<string>, n2: TocNode<string>): boolean => {
  /* istanbul ignore else */
  if (n1.type === TocNodeKind.Inner) {
    /* istanbul ignore next */
    if (n2.type !== n1.type) return false
    /* istanbul ignore next */
    return n1.title === n2.title && equalsArrayToc(n1.children, n2.children)
  } else {
    /* istanbul ignore next */
    if (n2.type !== n1.type) return false
    /* istanbul ignore next */
    return n1.page === n2.page
  }
}
const equalsArrayToc = equalsArray(equalsTocNode)

export const equalsBookToc = (n1: BookToc, n2: BookToc): boolean => {
  if (n1.uuid !== n2.uuid) return false
  if (n1.title !== n2.title) return false
  if (n1.slug !== n2.slug) return false
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

export function fromBook(book: BookNode): BookToc {
  return {
    uuid: book.uuid,
    title: book.title,
    slug: book.slug,
    language: book.language,
    licenseUrl: book.licenseUrl,
    tree: book.toc.map(recTree)
  }
}

export function toString(t: BookToc) {
  const doc = new DOMParser().parseFromString(BOOK_XML_TEMPLATE)

  selectOne('/col:collection/col:metadata/md:title', doc).textContent = t.title
  selectOne('/col:collection/col:metadata/md:slug', doc).textContent = t.slug
  selectOne('/col:collection/col:metadata/md:language', doc).textContent = t.language
  selectOne('/col:collection/col:metadata/md:uuid', doc).textContent = t.uuid
  const license = selectOne('//license', doc) as Element
  license.setAttribute('url', t.licenseUrl)

  const treeRoot = selectOne('//col:content', doc) as Element
  treeRoot.append(...t.tree.map(t => recBuild(doc, t)))
  return new XMLSerializer().serializeToString(doc)
}

function recTree(n: TocNodeWithRange): TocNode<string> {
  if (n.type === TocNodeKind.Leaf) {
    return { ...n, page: n.page.absPath }
  } else {
    return { ...n, children: n.children.map(recTree) }
  }
}

function recBuild(doc: Document, node: TocNode<string>): Element {
  if (node.type === TocNodeKind.Leaf) {
    const ret = doc.createElementNS(NS_COLLECTION, 'module')
    ret.setAttribute('document', node.page)
    return ret
  } else {
    const ret = doc.createElementNS(NS_COLLECTION, 'subcollection')
    const title = doc.createElementNS(NS_METADATA, 'title')
    const content = doc.createElementNS(NS_COLLECTION, 'content')
    title.textContent = node.title
    content.append(...node.children.map(c => recBuild(doc, c)))
    ret.append(title, content)
    return ret
  }
}
