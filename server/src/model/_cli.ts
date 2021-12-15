// ----------------------------------
// Example commandline book validator
// ----------------------------------

// -------------------------
// How to run:
//
// npx ts-node@10.1.0 ./_cli.ts /path/to/book/repo
//
// (10.2 has a bug: https://github.com/TypeStrong/ts-node/issues/1426)
// -------------------------

import http from 'http' // easier to use node-fetch but didn't want to add a dependency
import https from 'https'
import fs from 'fs'
import path from 'path'
import I from 'immutable'
import { PathHelper } from './utils'
import { Bundle } from './bundle'
import { ILoadable } from './fileish'
import { PageLinkKind } from './page'

console.log('WARN: Manually setting NODE_ENV=production so we get nicer error messages')
process.env.NODE_ENV = 'production'

const sleep = async (ms: number) => await new Promise((resolve) => setTimeout(resolve, ms))

function toRelPath(p: string) {
  return path.relative(process.cwd(), p)
}

function loadNode(n: ILoadable) {
  const bits = fs.existsSync(n.absPath) ? fs.readFileSync(n.absPath, 'utf-8') : undefined
  n.load(bits)
}

const pathHelper: PathHelper<string> = {
  join: path.join,
  dirname: path.dirname,
  canonicalize: (x) => x
}

;(async function () {
  const bookDirs = process.argv.length >= 3 ? process.argv.slice(2) : [process.cwd()]
  let errorCount = 0
  for (const rootPath of bookDirs) {
    console.log('Validating', toRelPath(rootPath))
    const bundle = new Bundle(pathHelper, rootPath)
    let nodesToLoad = I.Set<ILoadable>()
    do {
      nodesToLoad = bundle.allNodes.flatMap(n => n.validationErrors.nodesToLoad).filter(n => !n.isLoaded && n.validationErrors.errors.size === 0)
      console.log('Loading', nodesToLoad.size, 'file(s)...')
      nodesToLoad.forEach(loadNode)
    } while (nodesToLoad.size > 0)

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
            errorCount++
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
                        errorCount++
                        console.error('Double Redirect:', res.statusCode, link.url, 'to', destUrl, 'to', res.headers.location)
                      } else {
                        errorCount++
                        console.error('Error:', res.statusCode, link.url, 'to', destUrl)
                      }
                    }
                  })
                }
              } else {
                errorCount++
                console.error('Error:', res.statusCode, link.url)
              }
            }
          })
        }
      }
    }
    console.log('----------------------------')
    errorCount += validationErrors.size
  }
  await sleep(10 * 1000)
  process.exit(errorCount)
})().then(null, (err) => { throw err })
