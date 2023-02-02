import expect from 'expect'
import Sinon from 'sinon'
import mockfs from 'mock-fs'
import fetch, * as fetchModule from 'node-fetch'
import { FetchCache } from './fetch-cache'

const DUMMY_URL = 'https://example.com/dummy'

describe('FetchMemCache', () => {
  const sinon = Sinon.createSandbox()
  beforeEach(() => mockfs())
  afterEach(() => {
    sinon.restore()
    mockfs.restore()
  })

  function setFetch<T>(response: string | T, status = 200) {
    const fetchFn = async (url: string) => {
      const responseText = typeof response === 'string' ? response : JSON.stringify(response)
      return new fetchModule.Response(responseText, { status })
    }
    const spy = sinon.spy(fetchFn)
    FetchCache.fetchImpl = spy as unknown as typeof fetch
    return spy
  }
  it('fetches and stores an item in the cache and does not re-request for now', async () => {
    const fetchResponse = { hello: true }
    const fetchStub = setFetch(fetchResponse)
    const cache = new FetchCache()
    expect(fetchStub.callCount).toBe(0)
    const resp1 = await cache.get(DUMMY_URL)
    expect(fetchStub.callCount).toBe(1)
    expect(resp1).toEqual(fetchResponse)
    const resp2 = await cache.get(DUMMY_URL)
    expect(fetchStub.callCount).toBe(1)
    expect(resp2).toEqual(fetchResponse)
  })
  it('throws an error when the HTTP status is not 200', async () => {
    const cache = new FetchCache()
    const fetchStub = setFetch({}, 404)
    await expect(async () => await cache.get(DUMMY_URL)).rejects.toThrow()
    expect(fetchStub.callCount).toBe(1)
  })
  it('throws an error when the JSON is not well formed', async () => {
    const cache = new FetchCache()
    const fetchStub = setFetch('I am not valid stringified JSON', 200)
    await expect(async () => await cache.get(DUMMY_URL)).rejects.toThrow()
    expect(fetchStub.callCount).toBe(1)
  })
})
