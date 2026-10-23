import { describe, expect, it, vi } from 'vitest'
import { enrichSession } from '../enrich.ts'
import type { GeoLookup } from '../geoip.ts'
import { enrichmentResponseSchema } from '../schemas.ts'
import { androidChrome, berlin, ipadSafari, iphoneSafari, windowsChrome } from './fixtures.ts'

describe('session enrichment', () => {
  it('returns only the fields needed to recognize a session', async () => {
    const lookup = vi.fn<GeoLookup>(() => berlin)
    const result = await enrichSession({ ip: '8.8.8.8', user_agent: windowsChrome }, lookup)

    expect(lookup).toHaveBeenCalledExactlyOnceWith('8.8.8.8')
    expect(result).toEqual({
      device_type: 'desktop',
      device_model: null,
      browser: 'Chrome',
      os: 'Windows',
      country_code: 'DE',
      city: 'Berlin',
    })
    expect(enrichmentResponseSchema.safeParse(result).success).toBe(true)
  })

  it.each([
    ['iPhone', iphoneSafari, 'mobile', 'iOS'],
    ['iPad', ipadSafari, 'tablet', 'iOS'],
    ['Android', androidChrome, 'mobile', 'Android'],
  ])('recognizes %s without calling it a desktop', async (_name, user_agent, type, os) => {
    const result = await enrichSession({ ip: '127.0.0.1', user_agent })
    expect(result.device_type).toBe(type)
    expect(result.os).toBe(os)
  })

  it('uses Client Hints to recover details from a reduced Android User-Agent', async () => {
    const result = await enrichSession({
      ip: '127.0.0.1',
      user_agent: androidChrome,
      client_hints: {
        'sec-ch-ua': '"Chromium";v="130", "Google Chrome";v="130", "Not_A Brand";v="99"',
        'sec-ch-ua-full-version-list':
          '"Google Chrome";v="130.0.6723.58", "Chromium";v="130.0.6723.58", "Not_A Brand";v="99.0.0.0"',
        'sec-ch-ua-mobile': '?1',
        'sec-ch-ua-platform': '"Android"',
        'sec-ch-ua-model': '"Pixel 9"',
      },
    })
    expect(result).toEqual({
      device_type: 'mobile',
      device_model: 'Pixel 9',
      browser: 'Chrome',
      os: 'Android',
      country_code: null,
      city: null,
    })
  })

  it.each(['', 'unrecognized-agent/1.0', 'curl/8.0.1'])(
    'preserves unknowns for %j',
    async (user_agent) => {
      const result = await enrichSession({ ip: '127.0.0.1', user_agent })
      expect(result.device_type).toBe('unknown')
      expect(result.device_model).toBeNull()
      expect(result.country_code).toBeNull()
      expect(result.city).toBeNull()
      expect(enrichmentResponseSchema.safeParse(result).success).toBe(true)
    },
  )

  it('avoids labeling known bots as desktop sessions', async () => {
    const result = await enrichSession({
      ip: '127.0.0.1',
      user_agent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/130.0.0.0 Safari/537.36',
    })
    expect(result.device_type).toBe('unknown')
  })

  it.each([
    '0.0.0.0',
    '10.0.0.1',
    '127.0.0.1',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.1.1',
    '100.64.0.1',
    '192.0.2.1',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    'fc00::1',
    'fe80::1',
    'ff02::1',
    '2001:db8::1',
    '::ffff:192.168.1.1',
  ])('does not geolocate non-public address %s', async (ip) => {
    const lookup = vi.fn<GeoLookup>(() => berlin)
    const result = await enrichSession({ ip, user_agent: windowsChrome }, lookup)
    expect(lookup).not.toHaveBeenCalled()
    expect(result.country_code).toBeNull()
    expect(result.city).toBeNull()
  })

  it('normalizes IPv4-mapped IPv6 before lookup', async () => {
    const lookup = vi.fn<GeoLookup>(() => berlin)
    await enrichSession({ ip: '::ffff:0808:0808', user_agent: '' }, lookup)
    expect(lookup).toHaveBeenCalledExactlyOnceWith('8.8.8.8')
  })

  it('looks up public IPv6 in its normalized form', async () => {
    const lookup = vi.fn<GeoLookup>(() => berlin)
    await enrichSession({ ip: '2001:4860:4860:0000:0000:0000:0000:8888', user_agent: '' }, lookup)
    expect(lookup).toHaveBeenCalledExactlyOnceWith('2001:4860:4860::8888')
  })

  it('returns null for missing locations without losing device information', async () => {
    const result = await enrichSession({ ip: '8.8.8.8', user_agent: iphoneSafari }, () => null)
    expect(result.country_code).toBeNull()
    expect(result.city).toBeNull()
    expect(result.device_type).toBe('mobile')
  })

  it('keeps a known country when city data is missing', async () => {
    const result = await enrichSession({ ip: '8.8.8.8', user_agent: '' }, () => ({
      ...berlin,
      city: null,
    }))
    expect(result).toMatchObject({
      country_code: 'DE',
      city: null,
    })
  })

  it('does not expose unused fields from the location provider', async () => {
    const result = await enrichSession({ ip: '8.8.8.8', user_agent: '' }, () => ({
      ...berlin,
      latitude: 52.52,
      longitude: 13.405,
      timezone: 'Europe/Berlin',
    }))
    expect(result).toEqual({
      device_type: 'unknown',
      device_model: null,
      browser: null,
      os: null,
      country_code: 'DE',
      city: 'Berlin',
    })
  })
})
