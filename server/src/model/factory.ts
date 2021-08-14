import I from 'immutable'
import { Opt } from './utils'
export class Factory<T> {
  private _map = I.Map<string, T>()
  constructor(private readonly builder: (filePath: string) => T) { }
  getIfHas(absPath: string): Opt<T> {
    return this._map.get(absPath)
  }

  get(absPath: string) {
    const v = this._map.get(absPath)
    if (v !== undefined) {
      return v
    } else {
      const n = this.builder(absPath)
      this._map = this._map.set(absPath, n)
      return n
    }
  }

  public remove(absPath: string) {
    const item = this._map.get(absPath)
    this._map = this._map.delete(absPath)
    return item
  }

  public removeByKeyPrefix(pathPrefix: string) {
    const removedItems = this._map.filter((_, key) => key.startsWith(pathPrefix))
    this._map = this._map.filter((_, key) => !key.startsWith(pathPrefix))
    return I.Set(removedItems.values())
  }

  public get size() { return this._map.size }
  public get all() { return I.Set(this._map.values()) }
}
