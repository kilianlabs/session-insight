import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Reader } from 'mmdb-lib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openGeoDatabase } from '../geoip.ts'

const fixture = await readFile(new URL('./data/GeoLite2-City-Test.mmdb', import.meta.url))
const buildDate = new Reader(fixture).metadata.buildEpoch.getTime()
const hour = 60 * 60 * 1000
const day = 24 * hour
const response = (data = fixture) => new Response(new Uint8Array(data))
type Database = Awaited<ReturnType<typeof openGeoDatabase>>

describe('automatic GeoLite updates', () => {
  let directory: string
  const databases: Database[] = []
  const databasePath = () => join(directory, 'GeoLite2-City.mmdb')

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'session-insight-geoip-'))
    vi.useFakeTimers({
      toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
    })
    vi.setSystemTime(buildDate + day)
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(async () => {
    await Promise.all(databases.splice(0).map((database) => database.close()))
    vi.useRealTimers()
    vi.restoreAllMocks()
    await rm(directory, { recursive: true, force: true })
  })

  async function open(fetch: typeof globalThis.fetch) {
    const database = await openGeoDatabase({ directory, fetch })
    databases.push(database)
    return database
  }

  it('downloads and persists a real MMDB, preserving the enrichment fields', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response())
    const database = await open(fetch)
    expect(fetch).toHaveBeenCalledWith(
      'https://raw.githubusercontent.com/P3TERX/GeoLite.mmdb/download/GeoLite2-City.mmdb',
      { signal: expect.any(AbortSignal) },
    )
    expect(database.isReady()).toBe(true)
    expect(database.lookup('81.2.69.160')).toEqual({
      country_code: 'GB',
      city: 'London',
    })
    expect(database.lookup('2001:218::')?.country_code).toBe('JP')
    expect(database.lookup('127.0.0.1')).toBeNull()
    expect(await readFile(databasePath())).toEqual(fixture)
    expect(await readdir(directory)).toEqual(['GeoLite2-City.mmdb'])
  })

  it('starts with a valid cache when the mirror is offline', async () => {
    await writeFile(databasePath(), fixture)
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error('offline'))
    const database = await open(fetch)
    expect(database.lookup('81.2.69.160')?.city).toBe('London')
    await expect(database.update()).rejects.toThrow('offline')
    expect(await readFile(databasePath())).toEqual(fixture)
  })

  it.each(['http-error', 'invalid-mmdb', 'wrong-database', 'oversized', 'interrupted'])(
    'rejects %s without overwriting the active database',
    async (failure) => {
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(response())
      const database = await open(fetch)
      if (failure === 'http-error') fetch.mockResolvedValueOnce(new Response('', { status: 503 }))
      if (failure === 'invalid-mmdb') fetch.mockResolvedValueOnce(new Response('not a database'))
      if (failure === 'wrong-database') {
        const wrongType = Buffer.from(fixture)
        wrongType.write('GeoLite2-ASN_', wrongType.indexOf('GeoLite2-City'))
        fetch.mockResolvedValueOnce(response(wrongType))
      }
      if (failure === 'oversized') {
        fetch.mockResolvedValueOnce(
          new Response('too large', {
            headers: { 'content-length': String(129 * 1024 * 1024) },
          }),
        )
      }
      if (failure === 'interrupted') {
        fetch.mockResolvedValueOnce(
          new Response(
            new ReadableStream({
              start(controller) {
                controller.error(new Error('connection lost'))
              },
            }),
          ),
        )
      }
      await expect(database.update()).rejects.toThrow(Error)
      expect(database.isReady()).toBe(true)
      expect(database.lookup('81.2.69.160')?.city).toBe('London')
      expect(await readFile(databasePath())).toEqual(fixture)
      expect(await readdir(directory)).toEqual(['GeoLite2-City.mmdb'])
    },
  )

  it('switches readers only after a complete valid download and coalesces concurrent updates', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(response())
    const database = await open(fetch)
    const replacement = Buffer.from(fixture)
    for (
      let offset = replacement.indexOf('London');
      offset !== -1;
      offset = replacement.indexOf('London', offset + 6)
    ) {
      replacement.write('Oxford', offset)
    }
    let finishDownload: ((response: Response) => void) | undefined
    const pending = new Promise<Response>((resolve) => {
      finishDownload = resolve
    })
    fetch.mockReturnValueOnce(pending)
    const first = database.update()
    const second = database.update()
    expect(first).toBe(second)
    expect(database.lookup('81.2.69.160')?.city).toBe('London')
    expect(await readFile(databasePath())).toEqual(fixture)
    finishDownload?.(response(replacement))
    await first
    expect(database.lookup('81.2.69.160')?.city).toBe('Oxford')
    expect(await readFile(databasePath())).toEqual(replacement)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('updates daily and retries failed downloads after an hour', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => response())
    const database = await open(fetch)
    await vi.advanceTimersByTimeAsync(23 * hour)
    expect(fetch).toHaveBeenCalledTimes(1)
    fetch.mockRejectedValueOnce(new Error('offline'))
    await vi.advanceTimersByTimeAsync(hour)
    expect(fetch).toHaveBeenCalledTimes(2)
    await vi.waitFor(() =>
      expect(console.warn).toHaveBeenCalledWith(
        'GeoLite update failed; retrying in one hour',
        expect.objectContaining({ message: 'offline' }),
      ),
    )
    await vi.advanceTimersByTimeAsync(hour)
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3))
    await database.update()
    expect(database.isReady()).toBe(true)
  })

  it('rejects expired downloads and deletes expired cache data', async () => {
    await writeFile(databasePath(), fixture)
    vi.setSystemTime(buildDate + 30 * day)
    await expect(open(async () => response())).rejects.toThrow('expired')
    expect(await readdir(directory)).toEqual([])
  })

  it('stops serving expired data while retrying updates', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(response())
    const database = await open(fetch)
    fetch.mockRejectedValue(new Error('offline'))
    vi.setSystemTime(buildDate + 30 * day)
    expect(database.isReady()).toBe(false)
    expect(database.lookup('81.2.69.160')).toBeNull()
    await vi.advanceTimersByTimeAsync(hour)
    await vi.waitFor(async () => expect(await readdir(directory)).toEqual([]))
  })

  it('aborts an in-progress download and cancels scheduling on shutdown', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(response())
    const database = await open(fetch)
    fetch.mockImplementationOnce(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          })
        }),
    )
    const pending = database.update()
    const closing = database.close()
    await expect(pending).rejects.toThrow('aborted')
    await closing
    await vi.advanceTimersByTimeAsync(48 * hour)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(await readdir(directory)).toEqual(['GeoLite2-City.mmdb'])
  })

  it('cleans up an interrupted previous download and recovers a corrupt cache', async () => {
    await writeFile(`${databasePath()}.download`, 'partial download')
    await writeFile(databasePath(), 'corrupt cache')
    const database = await open(async () => response())
    expect(database.isReady()).toBe(true)
    expect(await readdir(directory)).toEqual(['GeoLite2-City.mmdb'])
  })

  it('cancels the initial download and removes partial data when startup is aborted', async () => {
    const controller = new AbortController()
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(
      async () =>
        new Response(
          new ReadableStream({
            start(stream) {
              stream.enqueue(new Uint8Array(fixture.subarray(0, 100)))
            },
          }),
        ),
    )
    const opening = openGeoDatabase({ directory, fetch, signal: controller.signal })
    await vi.waitFor(async () =>
      expect(await readdir(directory)).toContain('GeoLite2-City.mmdb.download'),
    )
    controller.abort()
    await expect(opening).rejects.toThrow(/abort/i)
    expect(await readdir(directory)).toEqual([])
    await vi.advanceTimersByTimeAsync(48 * hour)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
