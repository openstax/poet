import fs from 'fs'
import path from 'path'
import { PathHelper, profileAsync } from './model/utils'
import { TocNode, TocNodeType } from './model/book'
import { Bundle } from './model/bundle'

function printToc(node: TocNode, depth: number = 1) {
  const title = (node.type === TocNodeType.Inner) ? node.title : node.page.title(() => fs.readFileSync(node.page.absPath, 'utf-8'))
  console.log(`${' '.repeat(depth * 4)} ${title}`)
  if (node.type === TocNodeType.Inner) {
    node.children.forEach(c => printToc(c, depth + 1))
  }
}

const pathHelper: PathHelper<string> = {
  join: path.join,
  dirname: path.dirname
}

;(async function () {
  console.log('whole process took', (await profileAsync(async () => {
    const x = new Bundle(pathHelper, process.argv[2] ?? process.cwd())
    x.load(fs.readFileSync(x.absPath, 'utf-8'))

    console.log('After cheap load there are this many:')
    console.log('  Books', x.allBooks.all.size)
    console.log('  Pages', x.allPages.all.size)
    console.log('  Images', x.allImages.all.size)

    console.log('Tocs:')
    for (const b of x.allBooks.all) {
      b.load(fs.readFileSync(b.absPath, 'utf-8'))
      console.log(b.title)
      b.toc.forEach((a: TocNode) => printToc(a))
      console.log('------------------------')
    }

    console.log('After expensive load there are this many:')
    console.log('  Books', x.allBooks.all.size)
    console.log('  Pages', x.allPages.all.size)
    console.log('  Images', x.allImages.all.size)

    // console.log('Loaded Pages', x.allPages.all.filter(p => (p as any)._isLoaded).map(p => (p as any).filePath).toArray())
  }))[0], 'ms')
})().then(null, (err) => { throw err })
