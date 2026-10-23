import { describe, expect, it } from 'vitest'
import { readConfig } from '../config.ts'

describe('server configuration', () => {
  it('defaults to loopback and ignores unrelated environment variables', () => {
    expect(readConfig({ SOMETHING_ELSE: 'value' })).toEqual({
      HOST: '127.0.0.1',
      PORT: 3000,
      GEOIP_DATABASE_DIR: 'geoip-data',
    })
  })

  it('accepts explicit bind settings', () => {
    expect(
      readConfig({ HOST: '0.0.0.0', PORT: '8080', GEOIP_DATABASE_DIR: '/data/geoip' }),
    ).toEqual({
      HOST: '0.0.0.0',
      PORT: 8080,
      GEOIP_DATABASE_DIR: '/data/geoip',
    })
  })

  it('rejects an empty database directory', () => {
    expect(() => readConfig({ GEOIP_DATABASE_DIR: '' })).toThrow(/GEOIP_DATABASE_DIR/)
  })

  it.each(['', '0', '-1', '65536', '3000junk', '1.5', ' 3000'])(
    'fails early for invalid PORT %j',
    (PORT) => {
      expect(() => readConfig({ PORT })).toThrow(/PORT/)
    },
  )
})
