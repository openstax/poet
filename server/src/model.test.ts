import { readFileSync } from 'fs'
import * as path from 'path'
import I from 'immutable'
import { Bundle, Factory, Fileish, Opt, PageNode, PageValidationKind, PathHelper, UNTITLED_FILE } from './model'

const REPO_ROOT = path.join(__dirname, '..', '..')

describe('Page', () => {
  let page = null as unknown as PageNode
  beforeEach(() => {
    page = new PageNode(makeBundle(), FS_PATH_HELPER, '/some/path/filename')
  })
  it('can return a title before being loaded', () => {
    const quickTitle = 'quick title'
    expect(page.isLoaded()).toBe(false)
    const title = page.title(() => `a regexp reads this string so it does not have to be XML <title>${quickTitle}</title>.`)
    expect(title).toBe(quickTitle)
    expect(page.isLoaded()).toBe(false)
  })
  it('falls back if the quick-title did not find a title', () => {
    const quickTitle = 'quick title'
    expect(page.isLoaded()).toBe(false)
    let title = page.title(() => 'no title element to be seen in this contents')
    expect(title).toBe(UNTITLED_FILE)
    title = page.title(() => `<title>${quickTitle}</title>`)
    expect(title).toBe(quickTitle)
    title = page.title(() => 'Just an opening <title>but no closing tag')
    expect(title).toBe(UNTITLED_FILE)
    expect(page.isLoaded()).toBe(false)
  })
  it('sets Untitled when there is no title element in the CNXML', () => {
    page.load(pageMaker({ title: null }))
    expect(page.title(fail)).toBe(UNTITLED_FILE)
  })
  it('errors if there are two uuid elements (or any element that should occur exactly once in the doc)', () => {
    expect(() => page.load(pageMaker({ uuid: 'little bobby drop tables</md:uuid><md:uuid>injection is fun' })))
      .toThrow("Expected one but found 2 results that match '//md:uuid'")
  })
})

interface PageInfo {
  uuid?: string
  title?: string | null // null means omit the whole element
  imageHrefs?: string[]
  pageLinks?: Array<{targetPage?: string, targetId?: string, url?: string}>
}
function pageMaker(info: PageInfo) {
  const i = {
    title: info.title !== undefined ? info.title : 'TestTitle',
    uuid: info.uuid !== undefined ? info.uuid : '00000000-0000-4000-0000-000000000000',
    imageHrefs: info.imageHrefs !== undefined ? info.imageHrefs : [],
    pageLinks: info.pageLinks !== undefined ? info.pageLinks.map(({ targetPage, targetId, url }) => ({ targetPage, targetId, url })) : []
  }
  const titleElement = i.title === null ? '' : `<title>${i.title}</title>`
  return `<document xmlns="http://cnx.rice.edu/cnxml">
  ${titleElement}
  <metadata xmlns:md="http://cnx.rice.edu/mdml">
    <md:uuid>${i.uuid}</md:uuid>
  </metadata>
  <content>
    ${i.imageHrefs.map(href => `<image src="${href}"/>`).join('\n')}
    ${i.pageLinks.map(({ targetPage, targetId, url }) => `<link document="${targetPage ?? ''}" target-id="${targetId ?? ''}" url="${url ?? ''}"/>`).join('\n')}
    <para id="elementId1"/>
    <para id="elementId2"/>
  </content>
</document>`
}

describe('Page validations', () => {
  it(PageValidationKind.MISSING_IMAGE, () => {
    const bundle = makeBundle()
    const page = bundle.allPages.get('somepage/filename')
    const image = bundle.allImages.get('someimage')
    const info = { imageHrefs: [path.relative(path.dirname(page.absPath), image.absPath)] }
    page.load(pageMaker(info))
    // Verify the image needs to be loaded
    expect(image.isLoaded()).toBe(false)
    expect(first(page.getValidationErrors().nodesToLoad)).toBe(image)
    // At first the image does not exist:
    image.load(undefined)
    expect(first(page.getValidationErrors().errors).message).toBe(PageValidationKind.MISSING_IMAGE)
    // And then it does:
    image.load('somebits')
    expect(page.getValidationErrors().errors.size).toBe(0)
  })
  it(PageValidationKind.MISSING_TARGET, () => {
    const bundle = makeBundle()
    const page = bundle.allPages.get('modules/m123/index.cnxml')
    const target = bundle.allPages.get('modules/m234/index.cnxml')

    // Url (always ok)
    page.load(pageMaker({ pageLinks: [{ url: 'https://openstax.org' }] }))
    expect(page.getValidationErrors().errors.size).toBe(0)

    // Local id that does not exist
    page.load(pageMaker({ pageLinks: [{ targetId: 'nonexistentid' }] }))
    expect(page.getValidationErrors().errors.size).toBe(1)

    // Local id that does exist
    page.load(pageMaker({ pageLinks: [{ targetId: 'elementId1' }] }))
    expect(page.getValidationErrors().errors.size).toBe(0)

    page.load(pageMaker({ pageLinks: [{ targetPage: 'm234' }] }))
    // Verify the target needs to be loaded
    expect(target.isLoaded()).toBe(false)
    expect(first(page.getValidationErrors().nodesToLoad)).toBe(target)

    // At first the target does not exist:
    target.load(undefined)
    expect(first(page.getValidationErrors().errors).message).toBe(PageValidationKind.MISSING_TARGET)
    // And then it does:
    target.load(pageMaker({ uuid: '11111111-1111-4111-1111-111111111111' }))
    expect(page.getValidationErrors().errors.size).toBe(0)

    // Target with target-id
    page.load(pageMaker({ pageLinks: [{ targetPage: 'm234', targetId: 'nonexistentId' }] }))
    expect(page.getValidationErrors().errors.size).toBe(1)
    page.load(pageMaker({ pageLinks: [{ targetPage: 'm234', targetId: 'elementId1' }] }))
    expect(page.getValidationErrors().errors.size).toBe(0)
  })
  it(PageValidationKind.MALFORMED_UUID, () => {
    const bundle = makeBundle()
    const page = bundle.allPages.get('somepage/filename')
    const info = { uuid: 'invalid-uuid-value' }
    page.load(pageMaker(info))
    expect(first(page.getValidationErrors().errors).message).toBe(PageValidationKind.MALFORMED_UUID)
  })
  it(PageValidationKind.DUPLICATE_UUID, () => {
    const bundle = makeBundle()
    const page1 = bundle.allPages.get('somepage/filename')
    const page2 = bundle.allPages.get('somepage2/filename2')
    const info = { /* defaults */ }
    page1.load(pageMaker(info))
    page2.load(pageMaker(info))
    expect(page1.getValidationErrors().errors.size).toBe(1)
    expect(page2.getValidationErrors().errors.size).toBe(1)
    expect(first(page1.getValidationErrors().errors).message).toBe(PageValidationKind.DUPLICATE_UUID)
  })
  it('Reports multiple validation errors', () => {
    const bundle = makeBundle()
    const page = bundle.allPages.get('somepage')
    page.load(pageMaker({ uuid: 'malformed-uuid', pageLinks: [{ targetId: 'nonexistent' }] }))
    expect(page.getValidationErrors().errors.map(e => e.message).toArray().sort()).toEqual([PageValidationKind.MALFORMED_UUID, PageValidationKind.MISSING_TARGET].sort())
  })
})

describe('Book validations', () => {
  it.skip('Missing page', () => {})
  it.skip('Duplicate chapter title', () => {})
  it.skip('Duplicate page', () => {})
})

describe('Bundle validations', () => {
  it.skip('Missing book', () => {})
  it.skip('No books are defiend', () => {})
})

describe('Factory', () => {
  it('instantiates a new object when the key does not exist', () => {
    let counter = 0
    const f = new Factory(() => ({ thing: counter++ }))
    expect(f.getIfHas('key1')).toBeUndefined()
    expect(f.get('key1').thing).toEqual(0)
    expect(f.getIfHas('key1')).not.toBeUndefined()
    expect(f.get('key1').thing).toEqual(0)

    expect(f.getIfHas('key2')).toBeUndefined()
    expect(f.get('key2').thing).toEqual(1)
    expect(f.getIfHas('key2')).not.toBeUndefined()
  })
  it('removesByKeyPrefix works', () => {
    const f = new Factory((x) => ({ foo: x, bar: 'dummy-object' }))
    f.get('keyPrefix1')
    f.get('keyPrefix2')
    f.get('anotherprefix')
    f.get('not_a_keyPrefix')

    expect(f.all().size).toEqual(4)
    const removed = f.removeByKeyPrefix('keyPrefix')
    expect(removed.size).toEqual(2)
    expect(f.all().size).toEqual(2)
  })
})

describe('Happy path', () => {
  let bundle = null as unknown as Bundle

  beforeEach(() => {
    bundle = makeBundle()
    bundle.load(read(bundle.absPath))
  })
  it('loads the book bundle', () => {
    expect(bundle.exists()).toBeTruthy()
    expect(bundle.isLoaded()).toBeTruthy()
    expect(bundle.books().size).toBe(1)
  })
  it('loads the Book', () => {
    const book = first(bundle.books())
    loadSuccess(book)
  })
  it('loads a Page', () => {
    const book = loadSuccess(first(bundle.books()))
    const page = first(book.pages())
    loadSuccess(page)
  })
})

describe('The abstract ancestor class', () => {
  let previousNodeEnv: Opt<string>
  class MyNode extends Fileish {
    protected getValidationChecks() { return [] }
  }
  class MyXMLNode extends MyNode {
    protected parseXML = (doc: Document) => {
      throw new Error('I-always-throw-an-error')
    }
  }
  beforeEach(() => { previousNodeEnv = process.env.NODE_ENV })
  afterEach(() => { process.env.NODE_ENV = previousNodeEnv })
  it('marks a missing file as loaded but not existing', () => {
    const f = new MyNode(makeBundle(), FS_PATH_HELPER, '/to/nowhere/filename')
    expect(f.isLoaded()).toBe(false)
    expect(f.exists()).toBe(false)
    f.load(undefined)
    expect(f.isLoaded()).toBe(true)
    expect(f.exists()).toBe(false)
  })
  it('marks a file as loaded if there is no parseXML method', () => {
    const f = new MyNode(makeBundle(), FS_PATH_HELPER, '/to/nowhere/filename')
    f.load('the contents of a beutiful sunset')
    expect(f.exists()).toBe(true)
  })
  it('sends one nodesToLoad when the object has not been loaded yet', () => {
    const f = new MyNode(makeBundle(), FS_PATH_HELPER, '/to/nowhere/filename')
    const v = f.getValidationErrors()
    expect(v.errors.size).toBe(0)
    expect(v.nodesToLoad.size).toBe(1)
    expect(first(v.nodesToLoad)).toBe(f)
  })
  it('sends zero validation errors when the file does not exist', () => {
    const f = new MyNode(makeBundle(), FS_PATH_HELPER, '/to/nowhere/filename')
    f.load(undefined)
    const v = f.getValidationErrors()
    expect(v.errors.size).toBe(0)
    expect(v.nodesToLoad.size).toBe(0)
  })
  it('sends all parse errros as a diagnostic message in production (instead of throwing them)', () => {
    process.env.NODE_ENV = 'production'
    const f = new MyXMLNode(makeBundle(), FS_PATH_HELPER, '/to/nowhere/filename')
    f.load('>invalid-xml')
    expect(f.getValidationErrors().errors.size).toBe(1)
    const err = first(f.getValidationErrors().errors)
    expect(err.message).toBe('I-always-throw-an-error')
  })
})

describe('Bugfixes', () => {
  it('clears parse errors when the file parses correctly', () => {
    const bundle = makeBundle()
    ignoreConsoleWarnings(() => {
      bundle.load('<invalid this-is-intentionally-invalid-XML content')
    })
    expect(bundle.getValidationErrors().errors.size).toBe(1)
    loadSuccess(bundle)
    expect(bundle.getValidationErrors().errors.size).toBe(0)
  })
})

export const read = (filePath: string) => readFileSync(filePath, 'utf-8')

export const FS_PATH_HELPER: PathHelper<string> = {
  join: path.join,
  dirname: path.dirname
}

export function first<T>(col: I.Set<T> | I.List<T>) {
  const f = col.toArray()[0]
  expect(f).toBeTruthy()
  return f
}

export const makeBundle = () => new Bundle(FS_PATH_HELPER, REPO_ROOT)

export function loadSuccess<T extends Fileish>(n: T) {
  expect(n.isLoaded()).toBeFalsy()
  n.load(read(n.absPath))
  expect(n.isLoaded()).toBeTruthy()
  expect(n.exists()).toBeTruthy()
  expect(n.getValidationErrors().errors.size).toBe(0)
  return n // for daisy-chaining
}

export function ignoreConsoleWarnings(fn: () => void) {
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
  fn()
  warnSpy.mockRestore()
}
