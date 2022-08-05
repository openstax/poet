import { MathValidationKind } from './mathml-validator'
import { expectErrors, makeBundle, pageMaker } from './spec-helpers.spec'

describe('MathML Validator', () => {
  it('causes no errors to use valid values', () => {
    const bundle = makeBundle()
    const page = bundle.allPages.getOrAdd('somepage/filename')
    const info = {
      extraCnxml: '<math xmlns="http://www.w3.org/1998/Math/MathML" display="inline"><mspace width="0.5em"/></math>'
    }
    page.load(pageMaker(info))
    expectErrors(page, [])
  })
  it(`causes ${MathValidationKind.EMPTY_MSPACE_WIDTH.title} when mspace width is empty`, () => {
    const bundle = makeBundle()
    const page = bundle.allPages.getOrAdd('somepage/filename')
    const info = {
      extraCnxml: '<math xmlns="http://www.w3.org/1998/Math/MathML" display="inline"><mspace width=""/></math>'
    }
    page.load(pageMaker(info))
    expectErrors(page, [MathValidationKind.EMPTY_MSPACE_WIDTH])
  })
  it(`causes ${MathValidationKind.NEGATIVE_MSPACE_WIDTH.title} when mspace width is negative`, () => {
    const bundle = makeBundle()
    const page = bundle.allPages.getOrAdd('somepage/filename')
    const info = {
      extraCnxml: '<math xmlns="http://www.w3.org/1998/Math/MathML" display="inline"><mspace width="-0.2em"/></math>'
    }
    page.load(pageMaker(info))
    expectErrors(page, [MathValidationKind.NEGATIVE_MSPACE_WIDTH])
  })
})
