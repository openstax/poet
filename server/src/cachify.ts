import memoizeOne from 'memoize-one'
import { v4 as uuidv4 } from 'uuid'

export type Cachified<T> = CacheVerified & Wraps<T>
export interface CacheVerified {
  cacheKey: string
}
export interface Wraps<T> {
  inner: T
}

export const cachify = <T>(inner: T): Cachified<T> => {
  return {
    cacheKey: uuidv4(),
    inner
  }
}
export const staticCachify = <T>(key: string, inner: T): Cachified<T> => {
  return {
    cacheKey: key,
    inner
  }
}
export const recachify = <T>(cachified: Cachified<T>): Cachified<T> => {
  return {
    cacheKey: uuidv4(),
    inner: cachified.inner
  }
}

export const cacheEquals = (one: CacheVerified, other: CacheVerified): boolean => {
  return one.cacheKey === other.cacheKey
}

export const cacheListsEqual = (one: CacheVerified[], other: CacheVerified[]): boolean => {
  if (one.length !== other.length) {
    return false
  }
  for (let i = 0; i < one.length; i++) {
    const item = one[i]
    const otherItem = other[i]
    if (!cacheEquals(item, otherItem)) {
      return false
    }
  }
  return true
}

// works for singular and one-level nested array and set args
// one-level nested array cache equality is order dependent
export const cacheArgsEqual = (args: Array<CacheVerified | CacheVerified[]>, otherArgs: Array<CacheVerified | CacheVerified[]>): boolean => {
  if (args.length !== otherArgs.length) {
    return false
  }
  for (let i = 0; i < args.length; i++) {
    const item = args[i]
    const otherItem = otherArgs[i]
    if (item instanceof Array !== otherItem instanceof Array) {
      return false
    }
    if (item instanceof Array) {
      if (!cacheListsEqual(item, otherItem as CacheVerified[])) {
        return false
      }
    } else {
      if (!cacheEquals(item, otherItem as CacheVerified)) {
        return false
      }
    }
  }
  return true
}

export const cacheSort = <T extends CacheVerified>(items: T[]): T[] => {
  return items.sort((a, b) => a.cacheKey.localeCompare(b.cacheKey))
}

export const memoizeOneCache = <T extends (this: any, ...newArgs: any[]) => ReturnType<T>>(args: T): T => {
  return memoizeOne(args, cacheArgsEqual)
}
