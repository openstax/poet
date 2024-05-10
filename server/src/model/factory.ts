import * as Quarx from 'quarx'
import I from 'immutable'
import { type Opt } from './utils'
export class Factory<T> {
  private readonly _map = Quarx.observable.box(I.Map<string, T>())
  constructor(private readonly builder: (filePath: string) => T, private readonly canonicalizer: (filePath: string) => string) { }
  get(absPath: string): Opt<T> {
    const m = this._map.get()
    return m.get(absPath)
  }

  getOrAdd(absPath: string) {
    absPath = this.canonicalizer(absPath)
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

  public findByKeyPrefix(pathPrefix: string) {
    pathPrefix = this.canonicalizer(pathPrefix)
    const m = this._map.get()
    const matchingItems = m.filter((_, key) => key.startsWith(pathPrefix))
    return I.Set(matchingItems.values())
  }

  public get size() { return this._map.get().size }
  public get all() { return I.Set(this._map.get().values()) }
}
