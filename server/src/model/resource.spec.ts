import { ResourceValidationKind } from './resource'
import { bundleMaker, expectErrors, makeBundle } from './spec-helpers.spec'

describe('Resource validations', () => {
  it(ResourceValidationKind.DUPLICATE_RESOURCES.title, () => {
    const bundle = makeBundle()
    bundle.load(bundleMaker({}))
    const r1 = bundle.allResources.getOrAdd('media/foo.txt')
    r1.load('bits-dont-matter')
    expectErrors(r1, []) // No error when there is no file with a similar name

    const r2 = bundle.allResources.getOrAdd('media/FOO.TXT')
    r2.load('bits-dont-matter')
    expectErrors(r1, [ResourceValidationKind.DUPLICATE_RESOURCES])
    expectErrors(r2, [ResourceValidationKind.DUPLICATE_RESOURCES])
  })
})
