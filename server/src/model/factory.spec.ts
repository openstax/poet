import expect from 'expect'
import { Factory } from './factory'

describe('Factory', () => {
  it('instantiates a new object when the key does not exist', () => {
    let counter = 0
    const f = new Factory(() => ({ thing: counter++ }), (x) => x)
    expect(f.get('key1')).toBeUndefined()
    expect(f.getOrAdd('key1').thing).toEqual(0)
    expect(f.get('key1')).not.toBeUndefined()
    expect(f.getOrAdd('key1').thing).toEqual(0)

    expect(f.get('key2')).toBeUndefined()
    expect(f.getOrAdd('key2').thing).toEqual(1)
    expect(f.get('key2')).not.toBeUndefined()
  })
  it('removesByKeyPrefix works', () => {
    const f = new Factory((x) => ({ foo: x, bar: 'dummy-object' }), (x) => x)
    f.getOrAdd('keyPrefix1')
    f.getOrAdd('keyPrefix2')
    f.getOrAdd('anotherprefix')
    f.getOrAdd('not_a_keyPrefix')

    expect(f.size).toEqual(4)
    const removed = f.removeByKeyPrefix('keyPrefix')
    expect(removed.size).toEqual(2)
    expect(f.size).toEqual(2)
  })
})
