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
    console.error('Validating', path.relative(process.cwd(), rootPath))
    const bundle = new Bundle(pathHelper, rootPath)
    let nodesToLoad = I.Set<Fileish>()
    do {
      nodesToLoad = bundle.allNodes.flatMap(n => n.validationErrors.nodesToLoad)
      console.error('Loading', nodesToLoad.size, 'files...')
      nodesToLoad.forEach(loadNode)
    } while (nodesToLoad.size > 0)

    console.error('')
    console.error('This directory contains:')
    console.error('  Books', bundle.allBooks.size)
    console.error('  Pages', bundle.allPages.size)
    console.error('  Images', bundle.allImages.size)

    const validationErrors = bundle.allNodes.flatMap(n => n.validationErrors.errors)
    console.error('Validation Errors:', validationErrors.size)
    validationErrors.forEach(e => {
      console.log(path.relative(process.cwd(), e.node.absPath), `${e.startPos.line}:${e.startPos.character}`, e.message)
    })
    console.error('')
    errorCount += validationErrors.size
  }

  process.exit(errorCount)
})().then(null, (err) => { throw err })
