import expect from 'expect'
import * as path from 'path'
import { ELEMENT_TO_PREFIX, PageNode, PageValidationKind, UNTITLED_FILE } from './page'
import { expectErrors, first, FS_PATH_HELPER, makeBundle } from './util.spec'

describe('Page', () => {
  let page = null as unknown as PageNode
  beforeEach(() => {
    page = new PageNode(makeBundle(), FS_PATH_HELPER, '/some/path/filename')
  })
  it('can return a title before being loaded', () => {
    const quickTitle = 'quick title'
    expect(page.isLoaded).toBe(false)
    const title = page.title(() => `a regexp reads this string so it does not have to be XML <title>${quickTitle}</title>.`)
    expect(title).toBe(quickTitle)
    expect(page.isLoaded).toBe(false)
  })
  it('falls back if the quick-title did not find a title', () => {
    const quickTitle = 'quick title'
    expect(page.isLoaded).toBe(false)
    let title = page.title(() => 'no title element to be seen in this contents')
    expect(title).toBe(UNTITLED_FILE)
    title = page.title(() => `<title>${quickTitle}</title>`)
    expect(title).toBe(quickTitle)
    title = page.title(() => 'Just an opening <title>but no closing tag')
    expect(title).toBe(UNTITLED_FILE)
    expect(page.isLoaded).toBe(false)
  })
  it('sets Untitled when there is no title element in the CNXML', () => {
    page.load(pageMaker({ title: null }))
    expect(page.optTitle).toBe(UNTITLED_FILE)
  })
  it('errors if there are two uuid elements (or any element that should occur exactly once in the doc)', () => {
    expect(() => page.load(pageMaker({ uuid: 'little bobby drop tables</md:uuid><md:uuid>injection is fun' })))
      .toThrow("Expected one but found 2 results that match '//md:uuid'")
  })
})

export interface PageInfo {
  uuid?: string
  title?: string | null // null means omit the whole element
  elementIds?: string[]
  imageHrefs?: string[]
  pageLinks?: Array<{targetPage?: string, targetId?: string, url?: string}>
  extraCnxml?: string
}
export function pageMaker(info: PageInfo) {
  const i = {
    title: info.title !== undefined ? info.title : 'TestTitle',
    uuid: info.uuid !== undefined ? info.uuid : '00000000-0000-4000-0000-000000000000',
    elementIds: info.elementIds !== undefined ? info.elementIds : [],
    imageHrefs: info.imageHrefs !== undefined ? info.imageHrefs : [],
    pageLinks: info.pageLinks !== undefined ? info.pageLinks.map(({ targetPage, targetId, url }) => ({ targetPage, targetId, url })) : [],
    extraCnxml: info.extraCnxml !== undefined ? info.extraCnxml : ''
  }
  const titleElement = i.title === null ? '' : `<title>${i.title}</title>`
  return `<document xmlns="http://cnx.rice.edu/cnxml">
  ${titleElement}
  <metadata xmlns:md="http://cnx.rice.edu/mdml">
    <md:uuid>${i.uuid}</md:uuid>
  </metadata>
  <content>
${i.imageHrefs.map(href => `    <image src="${href}"/>`).join('\n')}
${i.pageLinks.map(({ targetPage, targetId, url }) => `    <link document="${targetPage ?? ''}" target-id="${targetId ?? ''}" url="${url ?? ''}"/>`).join('\n')}
${i.elementIds.map(id => `<para id="${id}"/>`).join('\n')}
${i.extraCnxml}
  </content>
</document>`
}

describe('Page validations', () => {
  it(PageValidationKind.MISSING_RESOURCE.title, () => {
    const bundle = makeBundle()
    const page = bundle.allPages.getOrAdd('somepage/filename')
    const image = bundle.allResources.getOrAdd('someimage')
    const info = { imageHrefs: [path.relative(path.dirname(page.absPath), image.absPath)] }
    page.load(pageMaker(info))
    // Verify the image needs to be loaded
    expect(image.isLoaded).toBe(false)
    expect(first(page.validationErrors.nodesToLoad)).toBe(image)
    // At first the image does not exist:
    image.load(undefined)
    expect(first(page.validationErrors.errors).kind).toBe(PageValidationKind.MISSING_RESOURCE)
    // And then it does:
    image.load('somebits')
    expect(page.validationErrors.errors.size).toBe(0)
  })
  it(`${PageValidationKind.MISSING_RESOURCE.title} (iframe)`, () => {
    const bundle = makeBundle()
    const page = bundle.allPages.getOrAdd('somedir/filename.cnxml')
    const missingIframe = bundle.allResources.getOrAdd('somedir/invalid-path-to-interactive')
    missingIframe.load(undefined)
    const info = {
      extraCnxml: `
        <iframe src="https://openstax.org"/>
        <iframe src="http://openstax.org"/>
        <iframe src="./invalid-path-to-interactive"/>
    `
    }
    page.load(pageMaker(info))
    // Expect exactly one validation error
    expect(page.validationErrors.errors.size).toBe(1)
    expect(first(page.validationErrors.errors).kind).toBe(PageValidationKind.MISSING_RESOURCE)
  })
  it(PageValidationKind.MISSING_TARGET.title, () => {
    const bundle = makeBundle()
    const page = bundle.allPages.getOrAdd('modules/m123/index.cnxml')
    const target = bundle.allPages.getOrAdd('modules/m234/index.cnxml')

    // Url (always ok)
    page.load(pageMaker({ pageLinks: [{ url: 'https://openstax.org' }] }))
    expect(page.validationErrors.errors.size).toBe(0)

    // Local id that does not exist
    page.load(pageMaker({ pageLinks: [{ targetId: 'nonexistentid' }] }))
    expect(page.validationErrors.errors.size).toBe(1)

    // Local id that does exist
    page.load(pageMaker({ elementIds: ['elementId1'], pageLinks: [{ targetId: 'elementId1' }] }))
    expect(page.validationErrors.errors.size).toBe(0)

    page.load(pageMaker({ pageLinks: [{ targetPage: 'm234' }] }))
    // Verify the target needs to be loaded
    expect(target.isLoaded).toBe(false)
    expect(first(page.validationErrors.nodesToLoad)).toBe(target)

    // At first the target does not exist:
    target.load(undefined)
    expect(first(page.validationErrors.errors).kind).toBe(PageValidationKind.MISSING_TARGET)
    // And then it does:
    target.load(pageMaker({ uuid: '11111111-1111-4111-1111-111111111111' }))
    expect(page.validationErrors.errors.size).toBe(0)

    // Target with target-id
    target.load(pageMaker({ uuid: '11111111-1111-4111-1111-111111111111', elementIds: ['elementId1'] }))
    page.load(pageMaker({ pageLinks: [{ targetPage: 'm234', targetId: 'nonexistentId' }] }))
    expect(page.validationErrors.errors.size).toBe(1)
    page.load(pageMaker({ pageLinks: [{ targetPage: 'm234', targetId: 'elementId1' }] }))
    expect(page.validationErrors.errors.size).toBe(0)
  })
  it(PageValidationKind.MALFORMED_UUID.title, () => {
    const bundle = makeBundle()
    const page = bundle.allPages.getOrAdd('somepage/filename')
    const info = { uuid: 'invalid-uuid-value' }
    page.load(pageMaker(info))
    expect(first(page.validationErrors.errors).kind).toBe(PageValidationKind.MALFORMED_UUID)
  })
  it(PageValidationKind.DUPLICATE_UUID.title, () => {
    const bundle = makeBundle()
    const page1 = bundle.allPages.getOrAdd('somepage/filename')
    const page2 = bundle.allPages.getOrAdd('somepage2/filename2')
    const info = { /* defaults */ }
    page1.load(pageMaker(info))
    page2.load(pageMaker(info))
    expectErrors(page1, [PageValidationKind.DUPLICATE_UUID])
    expectErrors(page2, [PageValidationKind.DUPLICATE_UUID])
  })
  it('Reports multiple validation errors', () => {
    const bundle = makeBundle()
    const page = bundle.allPages.getOrAdd('somepage')
    page.load(pageMaker({ uuid: 'malformed-uuid', pageLinks: [{ targetId: 'nonexistent' }] }))
    expectErrors(page, [PageValidationKind.MALFORMED_UUID, PageValidationKind.MISSING_TARGET])
  })
  it(PageValidationKind.MISSING_ID.title, () => {
    const bundle = makeBundle()
    const page = bundle.allPages.getOrAdd('somepage/filename')
    const elementsThatRequireId = Array.from(ELEMENT_TO_PREFIX.keys()).map(tagName => `<${tagName}/>`)
    const expectedErrors = Array.from(ELEMENT_TO_PREFIX.keys()).map(_ => PageValidationKind.MISSING_ID)
    const info = {
      extraCnxml: elementsThatRequireId.join('')
    }
    page.load(pageMaker(info))
    expectErrors(page, expectedErrors)
  })
  it(`${PageValidationKind.MISSING_ID.title} Terms inside a definition are ignored`, () => {
    const bundle = makeBundle()
    const page = bundle.allPages.getOrAdd('somepage/filename')
    const info = {
      extraCnxml: '<definition id="test"><term>No id here is okay</term></definition>'
    }
    page.load(pageMaker(info))
    expectErrors(page, [])
  })
})
