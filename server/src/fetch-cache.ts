import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, mkdirpSync, readFileSync, writeFileSync } from 'fs-extra'
import fetch from 'node-fetch'

const cacheDir = join(tmpdir(), 'poet-cached-requests')

const currentVersion = 1

class FetchCacheError extends Error { }

function toFilename(url: string) {
  return join(cacheDir, `${encodeURIComponent(url)}.json`)
}
export class FetchCache<T> {
  public static fetchImpl = fetch // Allow tests to swap it out
  public static debug = console.debug

  private async fetchOrThrow<T>(url: string): Promise<T> {
    FetchCache.debug(`[FETCH_CACHE] Fetching ${url}`)
    const resp = await FetchCache.fetchImpl(url)
    if (resp.status !== 200) {
      throw new FetchCacheError(`Problem fetching '${url}'. Error: ${resp.status} ${resp.statusText}`)
    }
    try {
      return await resp.json() as T
    } catch (err) {
      throw new FetchCacheError(`This URL does not yield JSON: ${url}`)
    }
  }

  private readCache(url: string) {
    FetchCache.debug(`[FETCH_CACHE] Reading from cache at ${cacheDir} ${url}`)
    const filename = toFilename(url)
    const cacheItem = JSON.parse(readFileSync(filename, 'utf-8'))
    /* istanbul ignore if */
    if (cacheItem.version !== currentVersion) throw new Error(`Unsupported storage format. Expected version ${currentVersion}`)
    const ret = cacheItem.body
    // void this.updateCache(url) // Async update the JSON
    return ret
  }

  private async updateCache<T>(url: string) {
    const jsonBody = await this.fetchOrThrow<T>(url)
    const cacheItem = {
      version: currentVersion,
      body: jsonBody
    }
    mkdirpSync(cacheDir)
    writeFileSync(toFilename(url), JSON.stringify(cacheItem, null, 2))
    return jsonBody
  }

  public async get(url: string): Promise<T> {
    if (existsSync(toFilename(url))) {
      return this.readCache(url)
    } else {
      return await this.updateCache(url)
    }
  }
}

// /**
//  * This only makes an HTTP request if the value is not in the cache.
//  * To make this cache more robust it should use ETags when making a request.
//  */
// export class FetchMemCache<T> {
//   public static fetchImpl = fetch // Allow tests to swap it out
//
//   private readonly cache = new Map<string, T>()
//   private async fetchOrThrow<T>(url: string): Promise<T> {
//     const resp = await FetchMemCache.fetchImpl(url)
//     if (resp.status !== 200) {
//       throw new FetchMemCacheError(`Problem fetching '${url}'. Error: ${resp.status} ${resp.statusText}`)
//     }
//     try {
//       return await resp.json() as T
//     } catch (err) {
//       throw new FetchMemCacheError(`This URL does not yield JSON: ${url}`)
//     }
//   }
//
//   public async get(url: string) {
//     const v = await this.cache.get(url)
//     if (v === undefined) {
//       const r = await this.fetchOrThrow<T>(url)
//       this.cache.set(url, r)
//       return r
//     } else {
//       return v
//     }
//   }
// }
