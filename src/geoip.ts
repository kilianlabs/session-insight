import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { Reader } from 'mmdb-lib'
import type { CityResponse } from 'mmdb-lib'
import type { Location } from './schemas.ts'

const databaseUrl =
  'https://raw.githubusercontent.com/P3TERX/GeoLite.mmdb/download/GeoLite2-City.mmdb'
const hour = 60 * 60 * 1000
const day = 24 * hour
const maxAge = 30 * day
const maxBytes = 128 * 1024 * 1024

export type GeoLookup = (ip: string) => Location | null

export async function openGeoDatabase(options: {
  directory: string
  fetch?: typeof globalThis.fetch
  signal?: AbortSignal
}) {
  const fetch = options.fetch ?? globalThis.fetch
  const databasePath = join(options.directory, 'GeoLite2-City.mmdb')
  const downloadPath = `${databasePath}.download`
  const controller = new AbortController()
  const shutdownSignal = AbortSignal.any(
    options.signal ? [controller.signal, options.signal] : [controller.signal],
  )
  shutdownSignal.throwIfAborted()
  let reader: Reader<CityResponse> | undefined
  let updating: Promise<void> | undefined
  let updateTimer: NodeJS.Timeout | undefined

  const isReady = () =>
    Boolean(reader && Date.now() < reader.metadata.buildEpoch.getTime() + maxAge)
  console.info(`Loading GeoLite database from ${databasePath}`)
  await mkdir(options.directory, { recursive: true })
  await rm(downloadPath, { force: true })
  try {
    reader = await loadDatabase(databasePath)
    console.info('GeoLite database cache loaded')
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
      console.warn('Discarding unusable GeoLite database cache')
      await rm(databasePath, { force: true })
    }
  }

  async function download() {
    console.info('Downloading GeoLite database')
    const signal = AbortSignal.any([shutdownSignal, AbortSignal.timeout(120_000)])
    try {
      const response = await fetch(databaseUrl, { signal })
      if (!response.ok || !response.body) {
        await response.body?.cancel()
        throw new Error('GeoLite download failed')
      }
      if (Number(response.headers.get('content-length')) > maxBytes) {
        await response.body.cancel()
        throw new Error('GeoLite download exceeds size limit')
      }
      let bytes = 0
      const limit = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          bytes += chunk.length
          callback(
            bytes > maxBytes ? new Error('GeoLite download exceeds size limit') : null,
            chunk,
          )
        },
      })
      await pipeline(
        Readable.fromWeb(response.body),
        limit,
        createWriteStream(downloadPath, { flags: 'wx', mode: 0o600 }),
        { signal },
      )
      const replacement = await loadDatabase(downloadPath)
      if (reader && replacement.metadata.buildEpoch < reader.metadata.buildEpoch) {
        throw new Error('GeoLite download is older than the active database')
      }
      signal.throwIfAborted()
      await rename(downloadPath, databasePath)
      reader = replacement
      console.info('GeoLite database updated')
    } finally {
      await rm(downloadPath, { force: true })
    }
  }

  function update() {
    if (shutdownSignal.aborted) return Promise.reject(new Error('GeoLite updater is closed'))
    updating ??= download().finally(() => {
      updating = undefined
    })
    return updating
  }

  function reportFailure(error: unknown) {
    if (!shutdownSignal.aborted) {
      console.warn('GeoLite update failed; retrying in one hour', error)
    }
  }

  function scheduleUpdate(delay: number) {
    if (!shutdownSignal.aborted) {
      updateTimer = setTimeout(() => {
        void scheduledUpdate()
      }, delay).unref()
      console.info(
        `Next background GeoLite database update scheduled for ${new Date(Date.now() + delay).toISOString()}`,
      )
    }
  }

  async function scheduledUpdate() {
    console.info('Starting background GeoLite database update')
    try {
      await update()
      scheduleUpdate(day)
    } catch (error) {
      reportFailure(error)
      scheduleUpdate(hour)
    }
  }

  shutdownSignal.throwIfAborted()
  if (reader) {
    void scheduledUpdate()
  } else {
    // Do not accept traffic until the initial database is available.
    console.info('No usable GeoLite database cache; waiting for the initial download')
    await update()
    scheduleUpdate(day)
  }

  const timer = setInterval(() => {
    void maintain().catch(reportFailure)
  }, hour).unref()

  async function maintain() {
    if (updating) return
    if (reader && !isReady()) {
      reader = undefined
      await rm(databasePath, { force: true })
      console.warn('GeoLite database expired; geolocation is unavailable until an update succeeds')
    }
  }

  return {
    isReady,
    lookup: ((ip) => {
      const record = isReady() ? reader?.get(ip) : null
      return record ? toLocation(record) : null
    }) satisfies GeoLookup,
    update,
    async close() {
      clearInterval(timer)
      clearTimeout(updateTimer)
      controller.abort()
      await updating?.catch(() => {})
      console.info('Background GeoLite database updater stopped')
    },
  }
}

async function loadDatabase(path: string) {
  if ((await stat(path)).size > maxBytes) throw new Error('GeoLite database exceeds size limit')
  const reader = new Reader<CityResponse>(await readFile(path))
  const built = reader.metadata.buildEpoch.getTime()
  if (
    reader.metadata.databaseType !== 'GeoLite2-City' ||
    reader.metadata.ipVersion !== 6 ||
    !Number.isFinite(built) ||
    built > Date.now() + day ||
    Date.now() >= built + maxAge
  )
    throw new Error('GeoLite database is invalid or expired')
  // Exercise both search trees before replacing the active reader.
  reader.get('8.8.8.8')
  reader.get('2001:4860:4860::8888')
  return reader
}

function toLocation(geo: CityResponse): Location {
  const country = geo.country
  const countryCode =
    country?.iso_code && /^[A-Z]{2}$/.test(country.iso_code) ? country.iso_code : null
  return {
    country_code: countryCode,
    city: geo.city?.names?.en || null,
  }
}
