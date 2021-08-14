import { Factory } from './factory'

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

    expect(f.all.size).toEqual(4)
    const removed = f.removeByKeyPrefix('keyPrefix')
    expect(removed.size).toEqual(2)
    expect(f.all.size).toEqual(2)
  })
})
