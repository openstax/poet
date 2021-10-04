import * as Quarx from 'quarx'
import I from 'immutable'
import { Opt } from './utils'
export class Factory<T> {
  private readonly _map = Quarx.observable.box(I.Map<string, T>())
  constructor(private readonly builder: (filePath: string) => T) { }
  get(absPath: string): Opt<T> {
    const m = this._map.get()
    return m.get(absPath)
  }

  getOrAdd(absPath: string) {
    const m = this._map.get()
    const v = m.get(absPath)
    if (v !== undefined) {
      return v
    } else {
      const n = this.builder(absPath)
      this._map.set(m.set(absPath, n))
      return n
    }
  }

  public remove(absPath: string) {
    const m = this._map.get()
    const item = m.get(absPath)
    this._map.set(m.delete(absPath))
    return item
  }

  public removeByKeyPrefix(pathPrefix: string) {
    const m = this._map.get()
    const removedItems = m.filter((_, key) => key.startsWith(pathPrefix))
    this._map.set(m.filter((_, key) => !key.startsWith(pathPrefix)))
    return I.Set(removedItems.values())
  }

  public get size() { return this._map.get().size }
  public get all() { return I.Set(this._map.get().values()) }
}
