import { ResourceValidationKind } from './resource'
import { bundleMaker, expectErrors, makeBundle, newH5PPath } from './spec-helpers.spec'

describe('H5P validations', () => {
  it(ResourceValidationKind.DUPLICATE_RESOURCES.title, () => {
    const bundle = makeBundle()
    bundle.load(bundleMaker({}))
    const h5p = bundle.allH5P.getOrAdd(newH5PPath(bundle, 'abc'))
    h5p.load('bits-dont-matter')
    expectErrors(h5p, [])
  })
})
