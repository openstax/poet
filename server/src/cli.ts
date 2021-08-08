import { Bundle, PageNode, TocNode, TocNodeType } from "./model"
import { profileAsync } from "./utils"

function printToc(node: TocNode, depth: number = 1) {
    const title = (node.type === TocNodeType.Inner) ? node.title : node.page.title()
    console.log(`${' '.repeat(depth * 4)} ${title}`)
    if (node.type === TocNodeType.Inner) {
        node.children.forEach(c => printToc(c, depth + 1))
    }
}

(async function () {
    console.log('whole process took', (await profileAsync(async () => {

        const x = new Bundle(process.argv[2] || process.cwd())
        console.log('ms to load the ToC:', (await profileAsync(async () => await x.load()))[1])

        console.log('After cheap load there are this many:')
        console.log('  Books', (x.allBooks as any).size())
        console.log('  Pages', (x.allPages as any).size())
        console.log('  Images', (x.allImages as any).size())

        console.log('Tocs:')
        for (const b of (x.allBooks as any)._map.values()) {
            await b.load()
            console.log(b.title())
            b.toc().forEach((a: TocNode) => printToc(a))
            console.log('------------------------')
        }

        console.log('After expensive load there are this many:')
        console.log('  Books', (x.allBooks as any).size())
        console.log('  Pages', (x.allPages as any).size())
        console.log('  Images', (x.allImages as any).size())

        // console.log('Loaded Pages', x.allPages.all().filter(p => (p as any)._isLoaded).map(p => (p as any).filePath).toArray())

    }))[1], 'ms')

})().then(null, (err) => { throw err })
