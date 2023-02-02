import expect from 'expect'
import Immutable from 'immutable'
import * as path from 'path'
import { ValidationKind } from './fileish'
import { ELEMENT_TO_PREFIX, exerciseTagToUrl, EXERCISE_TAG_PREFIX_CONTEXT_ELEMENT_ID, EXERCISE_TAG_PREFIX_CONTEXT_PAGE_UUID, LINKED_EXERCISE_PREFIX_NICK_URL, LINKED_EXERCISE_PREFIX_TAG_URL, PageNode, PageValidationKind, UNTITLED_FILE } from './page'
import { expectErrors, first, FS_PATH_HELPER, makeBundle, PageInfo, pageMaker } from './spec-helpers.spec'

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

function expectPageErrors(expectedErrors: ValidationKind[], info: PageInfo, page?: PageNode) {
  if (page === undefined) {
    const bundle = makeBundle()
    page = bundle.allPages.getOrAdd('somepage/filename')
  }
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
    expectPageErrors([], {
      extraCnxml: `
        <iframe src="https://openstax.org"/>
        <iframe src="http://openstax.org"/>
    `
    })

    const bundle = makeBundle()
    const missingIframe = bundle.allResources.getOrAdd('somepage/invalid-path-to-interactive')
    missingIframe.load(undefined)

    expectPageErrors([PageValidationKind.MISSING_RESOURCE], {
      extraCnxml: '<iframe src="./invalid-path-to-interactive"/>'
    }, bundle.allPages.getOrAdd('somepage/filename'))
  })
  it(PageValidationKind.MISSING_TARGET.title, () => {
    const bundle = makeBundle()
    const page = bundle.allPages.getOrAdd('modules/m123/index.cnxml')
    const target = bundle.allPages.getOrAdd('modules/m234/index.cnxml')

    // Url (always ok)
    expectPageErrors([], { pageLinks: [{ url: 'https://openstax.org' }] })

    // Local id that does not exist
    expectPageErrors([PageValidationKind.MISSING_TARGET], {
      pageLinks: [{ targetId: 'nonexistentid' }]
    })

    // Local id that does exist
    expectPageErrors([], { elementIds: ['elementId1'], pageLinks: [{ targetId: 'elementId1' }] })

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

    expectPageErrors([PageValidationKind.MISSING_TARGET], {
      pageLinks: [{ url: '#anywhere' }]
    })
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
  it(PageValidationKind.EXERCISE_MISSING.title, () => {
    expectPageErrors([PageValidationKind.EXERCISE_MISSING], {
      pageLinks: [{ url: `${LINKED_EXERCISE_PREFIX_TAG_URL}ex1234` }]
    })
  })
  it(`${PageValidationKind.EXERCISE_MISSING.title} for a nickname`, () => {
    expectPageErrors([PageValidationKind.EXERCISE_MISSING], {
      pageLinks: [{ url: `${LINKED_EXERCISE_PREFIX_NICK_URL}ex1234` }]
    })
  })

  function buildPageWithExerciseLink(exTag: string, uuid?: string, bundle = makeBundle()) {
    const page = bundle.allPages.getOrAdd('somepage/filename')
    page.load(pageMaker({
      uuid,
      pageLinks: [{ url: `${LINKED_EXERCISE_PREFIX_TAG_URL}${exTag}` }]
    }))
    expect(page.exerciseURLs.size).toBe(1)
    expect(page.exerciseURLs.first()).toEqual(exerciseTagToUrl(exTag))
    return page
  }
  it(PageValidationKind.EXERCISE_COUNT_ZERO.title, () => {
    const exTag = 'ex1234'
    const page = buildPageWithExerciseLink(exTag)
    page.setExerciseCache(Immutable.Map([[page.exerciseURLs.first(), { items: [] }]]))
    expectErrors(page, [PageValidationKind.EXERCISE_COUNT_ZERO])
  })
  it(PageValidationKind.EXERCISE_COUNT_TOO_MANY.title, () => {
    const exTag = 'ex1234'
    const page = buildPageWithExerciseLink(exTag)
    const exerciseJSON = { tags: [] }
    page.setExerciseCache(Immutable.Map([[page.exerciseURLs.first(), {
      items: [
        exerciseJSON,
        exerciseJSON
      ]
    }]]))
    expectErrors(page, [PageValidationKind.EXERCISE_COUNT_TOO_MANY])
  })
  it(PageValidationKind.EXERCISE_NO_PAGES.title, () => {
    const exTag = 'ex1234'
    const page = buildPageWithExerciseLink(exTag)
    page.setExerciseCache(Immutable.Map([[page.exerciseURLs.first(), {
      items: [{ tags: [`${EXERCISE_TAG_PREFIX_CONTEXT_PAGE_UUID}:uuid-that-is-not-in-our-bundle`] }]
    }]]))
    expectErrors(page, [PageValidationKind.EXERCISE_NO_PAGES])
  })
  it(PageValidationKind.EXERCISE_PAGE_MISSING_FEATURE.title, () => {
    const exTag = 'ex1234'
    const uuid = '88888888-8888-4888-8888-888888888888'
    const bundle = makeBundle()
    const page = buildPageWithExerciseLink(exTag, uuid, bundle)
    expect(bundle.allPages.all.filter(p => !p.isLoaded).toArray()).toEqual([])
    page.setExerciseCache(Immutable.Map([[page.exerciseURLs.first(), {
      items: [{
        // Exercise JSON
        tags: [
          `${EXERCISE_TAG_PREFIX_CONTEXT_PAGE_UUID}:${uuid}`,
          `${EXERCISE_TAG_PREFIX_CONTEXT_ELEMENT_ID}:element-id-that-is-not-in-the-target-page-which-is-our-page`
        ]
      }]
    }]]))
    expectErrors(page, [PageValidationKind.EXERCISE_PAGE_MISSING_FEATURE])
  })
  it(PageValidationKind.EXERCISE_MISSING_TARGET_FEATURE.title, () => {
    const exTag = 'ex1234'
    const uuid = '88888888-8888-4888-8888-888888888888'
    const otherUUID = '77777777-7777-4777-7777-777777777777'
    const bundle = makeBundle()
    const page = buildPageWithExerciseLink(exTag, uuid, bundle)
    const otherPage = bundle.allPages.getOrAdd('someother/path')
    otherPage.load(pageMaker({ uuid: otherUUID }))
    page.setExerciseCache(Immutable.Map([[page.exerciseURLs.first(), {
      items: [{
        // Exercise JSON
        tags: [
          `${EXERCISE_TAG_PREFIX_CONTEXT_PAGE_UUID}:${otherUUID}`,
          `${EXERCISE_TAG_PREFIX_CONTEXT_ELEMENT_ID}:element-id-that-is-not-in-the-target-page-which-is-our-page`
        ]
      }]
    }]]))
    expectErrors(page, [PageValidationKind.EXERCISE_MISSING_TARGET_FEATURE])
  })
  it(`${PageValidationKind.EXERCISE_PAGE_MISSING_FEATURE.title}. Because the feature id is missing on the current page`, () => {
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
    expectErrors(page, [PageValidationKind.EXERCISE_PAGE_MISSING_FEATURE])
  })
})
