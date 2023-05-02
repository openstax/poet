import vscode from 'vscode'
import path from 'path'

import { DOMParser } from 'xmldom'
import * as xpath from 'xpath-ts'
import { expect, getRootPathUri } from './utils'

const NS_COLLECTION = 'http://cnx.rice.edu/collxml'
const NS_CNXML = 'http://cnx.rice.edu/cnxml'
const NS_METADATA = 'http://cnx.rice.edu/mdml'
const NS_CONTAINER = 'https://openstax.org/namespaces/book-container'

const select = xpath.useNamespaces({ cnxml: NS_CNXML, col: NS_COLLECTION, md: NS_METADATA, bk: NS_CONTAINER })
const selectOne = (sel: string, doc: Node): Element => {
  const ret = select(sel, doc) as Node[]
  /* istanbul ignore next */
  expect(ret.length === 1 || null, `ERROR: Expected one but found ${ret.length} results that match '${sel}'`)
  return ret[0] as Element
}

const bookTemplate = `\
# {{ book_title }}

[![Open in Gitpod](https://gitpod.io/button/open-in-gitpod.svg)](https://gitpod.io/from-referrer/)

_{{ book_title }}_ is a textbook published by [OpenStax](https://openstax.org/), a non profit organization that is part of [Rice University](https://www.rice.edu/).

The book can be viewed [online]({{ book_link }}), where you can also see a list of contributors.

## License
This book is available under the [{{ license_text }}](./LICENSE) license.

## Support
If you would like to support the creation of free textbooks for students, your [donations are welcome](https://riceconnect.rice.edu/donation/support-openstax-banner).
`

const bundleTemplate = `\
# {{ book_titles }}

[![Open in Gitpod](https://gitpod.io/button/open-in-gitpod.svg)](https://gitpod.io/from-referrer/)

_{{ book_titles }}_ are textbooks published by [OpenStax](https://openstax.org/), a non profit organization that is part of [Rice University](https://www.rice.edu/).

To view these books online and view contributors, please visit:
{{ book_links }}

## License
These books are available under the [{{ license_text }}](./LICENSE) license.

## Support
If you would like to support the creation of free textbooks for students, your [donations are welcome](https://riceconnect.rice.edu/donation/support-openstax-banner).
`

const BOOK_WEB_ROOT = 'https://openstax.org/details/books/'
const LICENSE_ATTRIBUTES: Record<string, string> = {
  by: 'Creative Commons Attribution',
  nc: 'NonCommercial',
  nd: 'NoDerivatives',
  sa: 'ShareAlike'
}

interface License {
  url: string
  type: string
  version: string
  text: string
}

interface ColMeta {
  title: string
  license: License
}

interface SlugMeta {
  slugName: string
  collectionId: string
  href: string
  colMeta: ColMeta
}

interface BookMeta {
  slugsMeta: SlugMeta[]
}

function getBooksXmlPath(bookPath: vscode.Uri) {
  return vscode.Uri.joinPath(bookPath, 'META-INF', 'books.xml')
}

function getColPath(booksXmlPath: vscode.Uri, href: string): vscode.Uri {
  return vscode.Uri.file(path.join(path.dirname(booksXmlPath.fsPath), href))
}

async function readFile(fileUri: vscode.Uri) {
  const fileData = await vscode.workspace.fs.readFile(fileUri)
  const fileContents = new TextDecoder().decode(fileData)
  return fileContents
}

async function writeFile(fileUri: vscode.Uri, fileData: string) {
  const encoded = new TextEncoder().encode(fileData)
  await vscode.workspace.fs.writeFile(fileUri, encoded)
}

export function getLicense(license: Element): License {
  let url = expect(license.getAttribute('url'), 'No license url').trim()
  expect(url.length > 0 || null, 'Empty license url')
  const isLocalized = url.includes('/deed.')
  if (url.endsWith('/')) {
    url = url.slice(0, url.length - 1)
  }
  const [attributes, version] = (
    isLocalized ? url.slice(0, url.lastIndexOf('/deed.')) : url
  ).split('/').slice(-2)
  const type = attributes.split('-')
    .map(attr => expect(LICENSE_ATTRIBUTES[attr], 'Unrecognized CC license attribute'))
    .join('-')
  const text = isLocalized || type.length === 0
    ? license.textContent?.trim()
    : type + ' License'
  if (text === undefined || text.length === 0) {
    throw new Error('Expected license text')
  }

  return { url, type, version, text }
}

async function getCollectionMeta(colPath: vscode.Uri): Promise<ColMeta> {
  const metaXpath = '//*[local-name() = "metadata"]'
  const titleXpath = `${metaXpath}/md:title`
  const licenseXpath = `${metaXpath}/md:license`

  const collection = await readFile(colPath)
  const doc = new DOMParser().parseFromString(collection)
  const title = expect(selectOne(titleXpath, doc).textContent, 'No title')
  const licenseEl = selectOne(licenseXpath, doc)

  return {
    title: title,
    license: getLicense(licenseEl)
  }
}

async function getBookMeta(bookPath: vscode.Uri): Promise<BookMeta> {
  const booksXmlPath = getBooksXmlPath(bookPath)
  const booksXml = await readFile(booksXmlPath)
  const doc = new DOMParser().parseFromString(booksXml)
  const slugsMeta: SlugMeta[] = []
  const slugs = select('//*[@slug]', doc) as Element[]
  for (const slug of slugs) {
    const slugName = expect(slug.getAttribute('slug'), 'Slug not found')
    const href = expect(slug.getAttribute('href'), 'Slug href not found')
    const collectionId = expect(
      slug.getAttribute('collection-id'),
      'collection-id not found'
    )
    const colPath = getColPath(booksXmlPath, href)
    const colMeta = await getCollectionMeta(colPath)
    slugsMeta.push({ slugName, collectionId, href, colMeta })
  }
  return { slugsMeta }
}

function createBookReadme(slugMeta: SlugMeta) {
  const replacements = {
    book_title: slugMeta.colMeta.title,
    book_link: `${BOOK_WEB_ROOT}${encodeURIComponent(slugMeta.slugName)}`,
    license_text: slugMeta.colMeta.license.text,
    license_type: slugMeta.colMeta.license.type,
    license_version: slugMeta.colMeta.license.version
  }
  return populateTemplate(bookTemplate, replacements)
}

function licenseEqual(a: License, b: License) {
  return a.type === b.type &&
    a.text === b.text &&
    a.url === b.url &&
    a.version === b.version
}

function createBundleReadme(slugsMeta: SlugMeta[]) {
  const license = slugsMeta[0].colMeta.license
  if (!slugsMeta.every(sm => licenseEqual(sm.colMeta.license, license))) {
    throw new Error('Licenses differ between collections')
  }
  const replacements = {
    book_titles:
      slugsMeta.map((s, i) =>
        i === slugsMeta.length - 1 ? `and ${s.colMeta.title}` : s.colMeta.title
      ).join(slugsMeta.length > 2 ? ', ' : ' '),
    book_links:
      slugsMeta.map(s =>
        `- _${s.colMeta.title}_ [online](${BOOK_WEB_ROOT}${encodeURIComponent(s.slugName)})`
      ).join('\n'),
    license_text: license.text,
    license_type: license.type,
    license_version: license.version
  }
  return populateTemplate(bundleTemplate, replacements)
}

function populateTemplate(template: string, replacements: Record<string, string>) {
  // '{{ x }}' -> replacements['x']
  return template.replace(/\{{2}.+?\}{2}/g, m => {
    const prop = m.slice(2, -2)
    const value = expect(replacements[prop.trim()], `${prop} is undefined`)
    return value
  })
}

async function writeReadme(bookPath: vscode.Uri) {
  const meta = await getBookMeta(bookPath)
  await writeFile(
    vscode.Uri.joinPath(bookPath, 'README.md'),
    meta.slugsMeta.length === 1
      ? createBookReadme(meta.slugsMeta[0])
      : createBundleReadme(meta.slugsMeta)
  )
}

export async function writeReadmeForWorkspace() {
  const bookPath = expect(getRootPathUri(), 'Could not get workspace root uri')
  await writeReadme(bookPath)
  void vscode.window.showInformationMessage('Done!', { title: 'Generate README' })
}
