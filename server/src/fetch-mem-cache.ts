import fetch from 'node-fetch'

class FetchMemCacheError extends Error { }

/**
 * This only makes an HTTP request if the value is not in the cache.
 * To make this cache more robust it should use ETags when making a request.
 */
export class FetchMemCache<T> {
  public static fetchImpl = fetch // Allow tests to swap it out

  private readonly cache = new Map<string, T>()
  private async fetchOrThrow<T>(url: string): Promise<T> {
    const resp = await FetchMemCache.fetchImpl(url)
    if (resp.status !== 200) {
      throw new FetchMemCacheError(`Problem fetching '${url}'. Error: ${resp.status} ${resp.statusText}`)
    }
    try {
      return await resp.json() as T
    } catch (err) {
      throw new FetchMemCacheError(`This URL does not yield JSON: ${url}`)
    }
  }

  public async get(url: string) {
    const v = await this.cache.get(url)
    if (v === undefined) {
      const r = await this.fetchOrThrow<T>(url)
      this.cache.set(url, r)
      return r
    } else {
      return v
    }
  }
}
