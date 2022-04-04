// ----------------------------------
// Example commandline book validator
// ----------------------------------

// -------------------------
// How to run:
//
// npx ts-node@10.1.0 ./_cli.ts lint /path/to/book/repo
// npx ts-node@10.1.0 ./_cli.ts shrink /path/to/book/repo bookslug:0,9.0,9.7 bookslug2:13.0
//
// (10.2 has a bug: https://github.com/TypeStrong/ts-node/issues/1426)
// -------------------------

import glob from 'glob'
import { DOMParser, XMLSerializer } from 'xmldom'
import http from 'http' // easier to use node-fetch but didn't want to add a dependency
import https from 'https'
import fs from 'fs'
import path from 'path'
import I from 'immutable'
import { expectValue, PathHelper, select, TocNodeKind } from './utils'
import { Bundle } from './bundle'
import { Fileish } from './fileish'
import { PageLinkKind, PageNode } from './page'
import { BookNode, TocNodeWithRange, TocPageWithRange, TocSubbookWithRange } from './book'
import { ResourceNode } from './resource'
import { removeNode, writeBookToc } from '../model-manager'
import { BookRootNode, BookToc, ClientTocNode } from '../../../common/src/toc'
import { fromBook, IdMap } from '../book-toc-utils'

console.log('WARN: Manually setting NODE_ENV=production so we get nicer error messages')
process.env.NODE_ENV = 'production'

const sleep = async (ms: number) => await new Promise((resolve) => setTimeout(resolve, ms))

function toRelPath(p: string) {
  return path.relative(process.cwd(), p)
}

function loadNode(n: Fileish) {
  const bits = fs.existsSync(n.absPath) ? fs.readFileSync(n.absPath, 'utf-8') : undefined
  n.load(bits)
}

const pathHelper: PathHelper<string> = {
  join: path.join,
  dirname: path.dirname,
  canonicalize: (x) => x
}

function loadRepo(repoPath: string) {
  const bundle = new Bundle(pathHelper, repoPath)
  let nodesToLoad = I.Set<Fileish>()
  do {
    nodesToLoad = bundle.allNodes.flatMap(n => n.validationErrors.nodesToLoad).filter(n => !n.isLoaded && n.validationErrors.errors.size === 0)
    console.log('Loading', nodesToLoad.size, 'file(s)...')
    nodesToLoad.forEach(loadNode)
  } while (nodesToLoad.size > 0)
  return bundle
}

async function load(bookDirs: string[]): Promise<[boolean, Bundle[]]> {
  let errorCount = 0
  const bundles = []
  for (const rootPath of bookDirs) {
    console.log('Validating', toRelPath(rootPath))
    const bundle = loadRepo(rootPath)

    console.log('')
    console.log('This directory contains:')
    console.log('  Books:', bundle.allBooks.size)
    console.log('  Pages:', bundle.allPages.size)
    console.log('  Images:', bundle.allResources.size)

    const validationErrors = bundle.allNodes.flatMap(n => n.validationErrors.errors)
    if (validationErrors.size > 0) {
      console.error('Validation Errors:', validationErrors.size)
    }
    validationErrors.forEach(e => {
      const { range } = e
      console.log(toRelPath(e.node.absPath), `${range.start.line}:${range.start.character}`, e.message)
    })
    bundles.push(bundle)
    errorCount += validationErrors.size
  }
  return [errorCount > 0, bundles]
}

async function lint(bookDirs: string[]) {
  const [hasErrors] = await load(bookDirs)
  process.exit(hasErrors ? 111 : 0)
}

async function lintLinks(bookDirs: string[]) {
  let [hasErrors, bundles] = await load(bookDirs)
  for (const bundle of bundles) {
    for (const page of bundle.allPages.all.filter(page => page.isLoaded && page.exists)) {
      for (const link of page.pageLinks) {
        if (link.type === PageLinkKind.URL) {
          const url = link.url
          console.log('Checking Link to URL', url)
          // const resp = await fetch(url)
          // if (resp.status < 200 || resp.status >= 300) {
          //   console.log(page.absPath, link.url)
          // }
          let proto: typeof http | typeof https = http
          if (url.startsWith('https:')) {
            proto = https
          }

          // Parse the URL first because it might not be valid
          try {
            // eslint-disable-next-line no-new
            new URL(url)
          } catch {
            hasErrors = true
            console.error(`Error: Could not parse URL '${url}' and urlEncoded to show any odd unicode characters`, encodeURI(url))
            continue
          }

          proto.get(url, res => {
            if (res.statusCode !== undefined) {
              if (res.statusCode >= 200 && res.statusCode < 300) {
                console.log('Ok:', res.statusCode, link.url)
              } else if (res.statusCode >= 300 && res.statusCode < 400) {
                console.log('Following Redirect:', res.statusCode, link.url)
                const destUrl = res.headers.location
                if (destUrl !== undefined) {
                  // -------------------
                  // Avert your eyes!
                  // This is lazy copy/pasta
                  // -------------------
                  let proto2: typeof http | typeof https = http
                  if (destUrl.startsWith('https:')) {
                    proto2 = https
                  }
                  proto2.get(destUrl, res => {
                    if (res.statusCode !== undefined) {
                      if (res.statusCode >= 200 && res.statusCode < 300) {
                        console.log('Ok:', res.statusCode, link.url, 'to', destUrl)
                      } else if (res.statusCode >= 300 && res.statusCode < 400) {
                        hasErrors = true
                        console.error('Double Redirect:', res.statusCode, link.url, 'to', destUrl, 'to', res.headers.location)
                      } else {
                        hasErrors = true
                        console.error('Error:', res.statusCode, link.url, 'to', destUrl)
                      }
                    }
                  })
                }
              } else {
                hasErrors = true
                console.error('Error:', res.statusCode, link.url)
              }
            }
          })
        }
      }
    }
  }
  console.log('----------------------------')
  await sleep(10 * 1000)
  process.exit(hasErrors ? 111 : 0)
}

async function orphans(bookDirs: string[]) {
  let [hasErrors, bundles] = await load(bookDirs)

  for (const bundle of bundles) {
    const repoRoot = path.join(path.dirname(bundle.absPath), '..')
    const allFiles = I.Set(glob.sync('**/*', { cwd: repoRoot, absolute: true }))
    const books = bundle.books
    const pages = books.flatMap(b => b.pages).filter(o => o.exists)
    const images = pages.flatMap(p => p.resources).filter(o => o.exists)

    const referencedNodes = books.union(pages).union(images)
    const referencedFiles = referencedNodes.map(o => o.absPath)

    const orphans = allFiles.subtract(referencedFiles)

    orphans.forEach(o => console.log('Orphan', o))
    console.log('Found orphans', orphans.size)

    hasErrors = hasErrors || orphans.size > 0
  }
  process.exit(hasErrors ? 111 : 0)
}

function recFindLeafPages(acc: TocPageWithRange[], node: TocSubbookWithRange) {
  node.children.forEach(c => {
    if (c.type === TocNodeKind.Page) {
      acc.push(c)
    } else {
      recFindLeafPages(acc, c)
    }
  })
}

function traverse(node: BookNode|TocNodeWithRange, indexes: number[]): TocPageWithRange[] {
  if (node instanceof BookNode) {
    return traverse(node.toc[indexes[0]], indexes.slice(1))
  } else if (node.type === TocNodeKind.Page) {
    if (indexes.length !== 0) { throw new Error(`Encountered a Page earlier than expected. The ToC indexes indicate we should keep going but the ToC tree has already arrived at this page: '${node.page.absPath}'`) }
    return [node]
  } else {
    if (indexes.length === 0) {
      // keep this whole Chapter/Unit
      const acc: TocPageWithRange[] = []
      recFindLeafPages(acc, node)
      return acc
    } else {
      return traverse(node.children[indexes[0]], indexes.slice(1))
    }
  }
}

/* Returns true if this node has nothing worth keeping (trimMe) */
function trimNodes(node: ClientTocNode|BookToc, keepPages: Set<PageNode>): boolean {
  if (node.type === TocNodeKind.Page) {
    const hasKeeper = [...keepPages].find(n => n.absPath === node.value.absPath) !== undefined
    return !hasKeeper
  } else {
    const pendingRemovals = new Set<ClientTocNode>()
    let children: ClientTocNode[] = []
    if (node.type === BookRootNode.Singleton) {
      children = node.tocTree
    } else {
      children = node.children
    }
    children.forEach(c => {
      if (trimNodes(c, keepPages)) {
        pendingRemovals.add(c)
      }
    })
    for (const r of pendingRemovals) {
      removeNode(node, r)
    }

    // node.children is rewritten inside removeNode() so re-get it
    if (node.type === BookRootNode.Singleton) {
      children = node.tocTree
    } else {
      children = node.children
    }

    return children.length === 0
  }
}
interface MinDefinition {
  slug: string
  sections: number[][]
}

function pageAccumulator(acc: Set<PageNode>, page: PageNode) {
  if (!acc.has(page)) {
    acc.add(page)
    page.pageLinks.forEach(l => {
      if (l.type === PageLinkKind.PAGE || l.type === PageLinkKind.PAGE_ELEMENT) {
        pageAccumulator(acc, l.page)
      }
    })
  }
}

async function shrink(repoDir: string, entries: MinDefinition[]) {
  const keepBooks = new Set<BookNode>()
  const keepPages = new Set<PageNode>()
  const keepResources = new Set<ResourceNode>()
  const bundle = loadRepo(repoDir)

  // Load up the initial dependencies (these will be Pages)
  entries.forEach(entry => {
    const book = expectValue(bundle.books.find(b => b.slug === entry.slug), `Could not find book with slug '${entry.slug}'`)
    const pages = entry.sections.map(s => traverse(book, s)).flat()
    keepBooks.add(book)
    pages.forEach(p => pageAccumulator(keepPages, p.page))
  })
  keepPages.forEach(p => {
    p.resources.forEach(r => keepResources.add(r))
    // Add any books whose pages are not in one of the books that have already been selected
    let isInABook = false
    keepBooks.forEach(b => {
      if (b.pages.contains(p)) {
        isInABook = true
      }
    })
    if (!isInABook) {
      // Find a book that it is in and add it to ourBooks
      bundle.books.forEach(b => {
        if (b.pages.contains(p)) {
          keepBooks.add(b)
        }
      })
    }
  })
  // Finally! We are ready to delete everything that is not in our keep set.
  // First, let's update the model with a simplified ToC for each book
  const tocIdMap = new IdMap<string, TocSubbookWithRange|PageNode>((v) => {
    return 'itdoesnotmatter'
  })
  for (const b of keepBooks) {
    const bookToc = fromBook(tocIdMap, b)
    trimNodes(bookToc, keepPages)
    await writeBookToc(b, bookToc)
  }

  // If the books have shrunk, then update the META-INF/books.xml file
  if (bundle.books.size !== keepBooks.size) {
    const keepSlugs = new Set([...keepBooks].map(b => b.slug))
    // Just parse the XML because we're lazy. Or maybe it's less work to generate new XML (minus the collection id)
    const metainfStr = fs.readFileSync(bundle.absPath, 'utf-8')
    const doc = new DOMParser().parseFromString(metainfStr, 'text/xml')

    const bookEls = [...select('/bk:container/bk:book', doc) as Element[]]
    bookEls.forEach(el => {
      if (!keepSlugs.has(expectValue(el.getAttribute('slug'), 'BUG: slug attribute is missing on book element'))) {
        expectValue(el.parentNode, 'BUG: the book element clearly has a parent element').removeChild(el)
      }
    })

    const serailizedXml = new XMLSerializer().serializeToString(doc)
    fs.writeFileSync(bundle.absPath, serailizedXml)
  }

  const filesToDelete = I.Set<Fileish>()
    .union(bundle.allBooks.all.subtract(I.Set(keepBooks)))
    .union(bundle.allPages.all.subtract(I.Set(keepPages)))
    .union(bundle.allResources.all.subtract(I.Set(keepResources)))
  console.log('Deleting files:', filesToDelete.size)
  filesToDelete.forEach(f => fs.unlinkSync(f.absPath))
}

;(async function () {
  switch (process.argv[2]) {
    case 'lint': {
      const bookDirs = process.argv.length >= 4 ? process.argv.slice(3) : [process.cwd()]
      await lint(bookDirs)
      break
    }
    case 'links': {
      const bookDirs = process.argv.length >= 4 ? process.argv.slice(3) : [process.cwd()]
      await lintLinks(bookDirs)
      break
    }
    case 'orphans': {
      const bookDirs = process.argv.length >= 4 ? process.argv.slice(3) : [process.cwd()]
      await orphans(bookDirs)
      break
    }
    case 'shrink': {
      const repoDir = process.argv[3]
      const args = process.argv.slice(4)
      const entries = args.map(entry => {
        const [slug, sectionsStr] = entry.split(':')
        const sections1 = sectionsStr.split(',')
        const sections = sections1.map(s => s.split('.').map(nStr => Number.parseInt(nStr)))
        return { slug, sections }
      })
      await shrink(repoDir, entries)
      break
    }
    default: {
      console.log(`Unsupported command '${process.argv[2]}'. Expected one of 'lint' or 'shrink'`)
      console.log('Help: specify the command followed by arguments:')
      console.log('./_cli.ts lint /path/to/book/repo')
      console.log('./_cli.ts links /path/to/book/repo')
      console.log('./_cli.ts orphans /path/to/book/repo')
      console.log('./_cli.ts shrink /path/to/book/repo bookslug:0,9.0,9.7 bookslug2:13.0')
    }
  }
})().then(null, (err) => { throw err })
