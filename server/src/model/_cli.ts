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

import fs from 'fs'
import path from 'path'
import I from 'immutable'
import { PathHelper } from './utils'
import { Bundle } from './bundle'
import { Fileish } from './fileish'

console.warn('WARN: Manually setting NODE_ENV=production so we get nicer error messages')
process.env.NODE_ENV = 'production'

function toRelPath(p: string) {
  return path.relative(process.cwd(), p)
}

function loadNode(n: Fileish) {
  const bits = fs.existsSync(n.absPath) ? fs.readFileSync(n.absPath, 'utf-8') : undefined
  n.load(bits)
}

const pathHelper: PathHelper<string> = {
  join: path.join,
  dirname: path.dirname
}

;(async function () {
  const bookDirs = process.argv.length >= 3 ? process.argv.slice(2) : [process.cwd()]
  let errorCount = 0
  for (const rootPath of bookDirs) {
    console.error('Validating', toRelPath(rootPath))
    const bundle = new Bundle(pathHelper, rootPath)
    let nodesToLoad = I.Set<Fileish>()
    do {
      nodesToLoad = bundle.allNodes.flatMap(n => n.validationErrors.nodesToLoad).filter(n => !n.isLoaded && n.validationErrors.errors.size === 0)
      console.error('Loading', nodesToLoad.size, 'file(s)...')
      nodesToLoad.forEach(loadNode)
    } while (nodesToLoad.size > 0)

    console.error('')
    console.error('This directory contains:')
    console.error('  Books:', bundle.allBooks.size)
    console.error('  Pages:', bundle.allPages.size)
    console.error('  Images:', bundle.allImages.size)

    const validationErrors = bundle.allNodes.flatMap(n => n.validationErrors.errors)
    console.error('Validation Errors:', validationErrors.size)
    validationErrors.forEach(e => {
      const { range } = e
      console.log(toRelPath(e.node.absPath), `${range.start.line}:${range.start.character}`, e.message)
    })
    console.error('----------------------------')
    errorCount += validationErrors.size
  }

  process.exit(errorCount)
})().then(null, (err) => { throw err })
