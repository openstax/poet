import { Bundle, PageNode, TocNode, Validator } from "./model"
import { profileAsync } from "./utils"

function printToc(node: TocNode, depth: number = 1) {
    let title = null
    if (node instanceof PageNode) {
        title = node.title()
    } else {
        title = node.title
    }
    console.log(`${' '.repeat(depth * 4)} ${title}`)
    if (!(node instanceof PageNode)) {
        node.children.forEach(c => printToc(c, depth + 1))
    }
}

(async function () {
    console.log('whole process took', (await profileAsync(async () => {

        const x = new Bundle(process.argv[2] || process.cwd())
        console.log('ms to load the ToC:', (await profileAsync(async () => await x.load(false)))[1])

        console.log('After cheap load there are this many:')
        console.log('  Books', (x.allBooks as any).size())
        console.log('  Pages', (x.allPages as any).size())
        console.log('  Images', (x.allImages as any).size())

        console.log('Tocs:')
        for (const b of (x.allBooks as any)._map.values()) {
            await b.load(false)
            console.log(b.title())
            b.toc().forEach((a: TocNode) => printToc(a))
            console.log('------------------------')
        }

        console.log('loading....')
        console.log('ms to load all the book data:', (await profileAsync(async () => await x.load(true)))[1])

        console.log('After expensive load there are this many:')
        console.log('  Books', (x.allBooks as any).size())
        console.log('  Pages', (x.allPages as any).size())
        console.log('  Images', (x.allImages as any).size())

        // console.log('Loaded Pages', x.allPages.all().filter(p => (p as any)._isLoaded).map(p => (p as any).filePath).toArray())
        const v = new Validator(x).validationErrors()
        console.log('Missing Images:', v.missingImages.size)
        console.log('Missing Page Targets:', v.missingPageTargets.size, 'of', x.books().flatMap(b => b.pages().flatMap(p => p.pageLinks())).size)
        console.log('Duplicate Pages in ToC:', v.duplicatePagesInToC.size)
        // console.log('here is one:', [...x.books().flatMap(b => b.brokenPageLinks())][0])

    }))[1], 'ms')

})().then(null, (err) => { throw err })
