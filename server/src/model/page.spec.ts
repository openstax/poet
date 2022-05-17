import expect from 'expect'
import Immutable from 'immutable'
import * as path from 'path'
import { ValidationKind } from './fileish'
import { ELEMENT_TO_PREFIX, exerciseTagToUrl, EXERCISE_TAG_PREFIX_CONTEXT_ELEMENT_ID, EXERCISE_TAG_PREFIX_CONTEXT_PAGE_UUID, PageNode, PageValidationKind, UNTITLED_FILE } from './page'
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

function expectPageErrors(expectedErrors: ValidationKind[], info: PageInfo) {
  const bundle = makeBundle()
  const page = bundle.allPages.getOrAdd('somepage/filename')
  page.load(pageMaker(info))
  expectErrors(page, expectedErrors)
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
    expectPageErrors([PageValidationKind.MALFORMED_UUID], { uuid: 'invalid-uuid-value' })
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
    expectPageErrors([PageValidationKind.MALFORMED_UUID, PageValidationKind.MISSING_TARGET], {
      uuid: 'malformed-uuid', pageLinks: [{ targetId: 'nonexistent' }]
    })
  })
  it(PageValidationKind.MISSING_ID.title, () => {
    const elementsThatRequireId = Array.from(ELEMENT_TO_PREFIX.keys()).map(tagName => `<${tagName}/>`)
    const expectedErrors = Array.from(ELEMENT_TO_PREFIX.keys()).map(_ => PageValidationKind.MISSING_ID)
    expectPageErrors(expectedErrors, {
      extraCnxml: elementsThatRequireId.join('')
    })
  })
  it(`${PageValidationKind.MISSING_ID.title} Terms inside a definition are ignored`, () => {
    expectPageErrors([], {
      extraCnxml: '<definition id="test"><term>No id here is okay</term></definition>'
    })
  })
  it(`${PageValidationKind.MALFORMED_EXERCISE.title}: Exercise has not been loaded by now. Could be a bug or an error from server`, () => {
    expectPageErrors([PageValidationKind.MALFORMED_EXERCISE], {
      extraCnxml: '<link url="#ost/api/ex/ex1234" />'
    })
  })

  function buildPageWithExerciseLink(exTag: string, uuid?: string) {
    const bundle = makeBundle()
    const page = bundle.allPages.getOrAdd('somepage/filename')
    page.load(pageMaker({
      uuid,
      extraCnxml: `<link url="#ost/api/ex/${exTag}" />`
    }))
    expect(page.exerciseURLs.size).toBe(1)
    expect(page.exerciseURLs.first()).toEqual(exerciseTagToUrl(exTag))
    return page
  }
  it(`${PageValidationKind.MALFORMED_EXERCISE.title}: Expected 1 exercise result but found 0 or at least 2`, () => {
    const exTag = 'ex1234'
    const page = buildPageWithExerciseLink(exTag)
    // 0 Results
    page.setExerciseCache(Immutable.Map([[page.exerciseURLs.first(), { items: [] }]]))
    expectErrors(page, [PageValidationKind.MALFORMED_EXERCISE])

    // 2 Results
    const exerciseJSON = { tags: [] }
    page.setExerciseCache(Immutable.Map([[page.exerciseURLs.first(), {
      items: [
        exerciseJSON,
        exerciseJSON
      ]
    }]]))
    expectErrors(page, [PageValidationKind.MALFORMED_EXERCISE])
  })
  it(`${PageValidationKind.MALFORMED_EXERCISE.title}: Did not find any pages in our bundle for the context for this exercise`, () => {
    const exTag = 'ex1234'
    const page = buildPageWithExerciseLink(exTag)
    page.setExerciseCache(Immutable.Map([[page.exerciseURLs.first(), {
      items: [{ tags: [`${EXERCISE_TAG_PREFIX_CONTEXT_PAGE_UUID}:uuid-that-is-not-in-our-bundle`] }]
    }]]))
    expectErrors(page, [PageValidationKind.MALFORMED_EXERCISE])
  })
  it(`${PageValidationKind.MALFORMED_EXERCISE.title}: context-feature does not exist in the target page`, () => {
    const exTag = 'ex1234'
    const uuid = '88888888-8888-4888-8888-888888888888'
    const page = buildPageWithExerciseLink(exTag, uuid)
    page.setExerciseCache(Immutable.Map([[page.exerciseURLs.first(), {
      items: [{
        // Exercise JSON
        tags: [
          `${EXERCISE_TAG_PREFIX_CONTEXT_PAGE_UUID}:${uuid}`,
          `${EXERCISE_TAG_PREFIX_CONTEXT_ELEMENT_ID}:element-id-that-is-not-in-the-target-page-which-is-our-page`
        ]
      }]
    }]]))
    expectErrors(page, [PageValidationKind.MALFORMED_EXERCISE])
  })
  it(`${PageValidationKind.MALFORMED_EXERCISE.title}: Exercise contains a context element ID but that ID is not available on this Page`, () => {
    const exTag = 'ex1234'
    const page = buildPageWithExerciseLink(exTag)
    page.setExerciseCache(Immutable.Map([[page.exerciseURLs.first(), {
      items: [{
        // Exercise JSON
        tags: [
          `${EXERCISE_TAG_PREFIX_CONTEXT_ELEMENT_ID}:element-id-that-is-not-in-our-page`
        ]
      }]
    }]]))
    expectErrors(page, [PageValidationKind.MALFORMED_EXERCISE])
  })
  it(`${PageValidationKind.MALFORMED_EXERCISE.title}: There were no context element IDs`, () => {
    const exTag = 'ex1234'
    const uuid = '88888888-8888-4888-8888-888888888888'
    const page = buildPageWithExerciseLink(exTag, uuid)
    page.setExerciseCache(Immutable.Map([[page.exerciseURLs.first(), {
      items: [{
        // Exercise JSON
        tags: [
          `${EXERCISE_TAG_PREFIX_CONTEXT_PAGE_UUID}:${uuid}`
        ]
      }]
    }]]))
    expectErrors(page, [PageValidationKind.MALFORMED_EXERCISE])
  })
})
