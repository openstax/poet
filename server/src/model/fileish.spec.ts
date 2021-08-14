import { Opt } from './utils'
import { Fileish } from './fileish'
import { first, FS_PATH_HELPER, makeBundle } from './util.spec'

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
