import { expect } from '@jest/globals'
import SinonRoot from 'sinon'
import { readFileSync } from 'fs'
import * as path from 'path'
import type I from 'immutable'
import { Bundle } from './bundle'
import { type Fileish, type ValidationKind } from './fileish'

describe('spec-helpers Dummy', () => {
  it('trivially passes because Jest requires every spec file to have at least one test', () => {
    expect(true).toBe(true)
  })
})

export const REPO_ROOT = path.join(__dirname, '..', '..', '..')

export const read = (filePath: string) => readFileSync(filePath, 'utf-8')

/* Copy/Pasted from ./utils.ts to remove cyclic dependency */
interface PathHelper<T> {
  join: (root: T, ...components: string[]) => T
  dirname: (p: T) => T
  canonicalize: (p: T) => T
}

export const FS_PATH_HELPER: PathHelper<string> = {
  join: (root, ...components) => path.join(root, ...components),
  dirname: (p) => path.dirname(p),
  canonicalize: (x) => x
}

export function first<T>(col: I.Set<T> | I.List<T>) {
  const f = col.toArray()[0]
  expect(f).toBeTruthy()
  return f
}

export const makeBundle = () => new Bundle(FS_PATH_HELPER, REPO_ROOT)

export function loadSuccess<T extends Fileish>(n: T, skipInitialLoadedCheck = false, expectedErrorCount = 0) {
  if (!skipInitialLoadedCheck) expect(n.isLoaded).toBeFalsy()
  n.load(read(n.absPath))
  expect(n.isLoaded).toBeTruthy()
  expect(n.exists).toBeTruthy()
  expect(n.validationErrors.errors.size).toBe(expectedErrorCount)
  return n // for daisy-chaining
}

export function ignoreConsoleWarnings(fn: () => void) {
  const warnStub = SinonRoot.stub(console, 'warn')
  fn()
  warnStub.restore()
}

export function expectErrors<T extends Fileish>(node: T, validationKinds: ValidationKind[]) {
  const v = node.validationErrors
  expect(v.nodesToLoad.size).toBe(0) // Everything should have loaded
  expect(v.errors.toArray().map(e => e.title).sort()).toEqual(validationKinds.map(v => v.title).sort())
}

export interface PageInfo {
  uuid?: string
  title?: string | null // null means omit the whole element
  elementIds?: string[]
  imageHrefs?: string[]
  pageLinks?: Array<{ targetPage?: string, targetId?: string, url?: string }>
  extraCnxml?: string
}
export function pageMaker(info: PageInfo) {
  const i = {
    title: info.title !== undefined ? info.title : 'TestTitle',
    uuid: info.uuid ?? '00000000-0000-4000-0000-000000000000',
    elementIds: info.elementIds ?? [],
    imageHrefs: info.imageHrefs ?? [],
    pageLinks: info.pageLinks !== undefined ? info.pageLinks.map(({ targetPage, targetId, url }) => ({ targetPage, targetId, url })) : [],
    extraCnxml: info.extraCnxml ?? ''
  }
  const titleElement = i.title === null ? '' : `<title>${i.title}</title>`
  return `<document xmlns="http://cnx.rice.edu/cnxml">
  ${titleElement}
  <metadata xmlns:md="http://cnx.rice.edu/mdml">
    <md:uuid>${i.uuid}</md:uuid>
  </metadata>
  <content>
${i.imageHrefs.map(href => `    <image src="${href}"/>`).join('\n')}
${i.pageLinks.map(({ targetPage, targetId, url }) => {
  let link = '   <link'
  if (targetPage !== undefined) link += ` document="${targetPage}"`
  if (targetId !== undefined) link += ` target-id="${targetId}"`
  if (url !== undefined) link += ` url="${url}"`
  link += '/>'
  return link
}).join('\n')}
${i.elementIds.map(id => `<para id="${id}"/>`).join('\n')}
${i.extraCnxml}
  </content>
</document>`
}

export type BookMakerTocNode = {
  title: string
  children: BookMakerTocNode[]
} | string
export interface BookMakerInfo {
  title?: string
  slug?: string
  uuid?: string
  language?: string
  licenseUrl?: string
  licenseText?: string
  toc?: BookMakerTocNode[]
}
export function bookMaker(info: BookMakerInfo) {
  const i = {
    title: info.title ?? 'test collection',
    slug: info.slug ?? 'slug1',
    langauge: info.language ?? 'xxyyzz',
    licenseUrl: info.licenseUrl ?? 'http://creativecommons.org/licenses/by/4.0/',
    licenseText: info.licenseText ?? '',
    uuid: info.uuid ?? '00000000-0000-4000-0000-000000000000',
    toc: info.toc ?? []
  }
  return `<col:collection xmlns:col="http://cnx.rice.edu/collxml" xmlns:md="http://cnx.rice.edu/mdml" xmlns="http://cnx.rice.edu/collxml">
    <col:metadata>
      <md:title>${i.title}</md:title>
      <md:slug>${i.slug}</md:slug>
      <md:uuid>${i.uuid}</md:uuid>
      <md:language>${i.langauge}</md:language>
      ${i.licenseText === ''
        ? `<md:license url="${i.licenseUrl}"/>`
        : `<md:license url="${i.licenseUrl}">${i.licenseText}</md:license>`
      }
    </col:metadata>
    <col:content>
        ${i.toc.map(tocToString).join('\n')}
    </col:content>
</col:collection>`
}
function tocToString(node: BookMakerTocNode): string {
  if (typeof node === 'string') {
    return `<col:module document="${node}" />`
  } else {
    return `<col:subcollection>
        <md:title>${node.title}</md:title>
        <col:content>
            ${node.children.map(tocToString).join('\n')}
        </col:content>
    </col:subcollection>`
  }
}

interface BundleMakerInfo {
  version?: number
  books?: Array<string | { slug: string, href: string }>
}
export function bundleMaker(info: BundleMakerInfo) {
  const i = {
    version: info.version ?? 1,
    books: (info.books ?? []).map(b => {
      if (typeof b === 'string') {
        const slug = b
        return { slug, href: `../collections/${slug}.collection.xml` }
      } else {
        return b
      }
    })
  }
  return `<container xmlns="https://openstax.org/namespaces/book-container" version="1">
${i.books.map(({ slug, href }) => `<book slug="${slug}" href="${href}" />`).join('\n')}
</container>`
}
