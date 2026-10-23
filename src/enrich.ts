import ipaddr from 'ipaddr.js'
import { UAParser } from 'ua-parser-js'
import { isBot } from 'ua-parser-js/bot-detection'
import { deviceTypeSchema } from './schemas.ts'
import type { EnrichmentRequest, EnrichmentResponse } from './schemas.ts'
import type { GeoLookup } from './geoip.ts'

const desktopSystems = new Set([
  'Windows',
  'macOS',
  'Mac OS',
  'Linux',
  'Ubuntu',
  'Debian',
  'Fedora',
  'Chrome OS',
  'Chromium OS',
])

export async function enrichSession(
  input: EnrichmentRequest,
  lookup: GeoLookup = () => null,
): Promise<EnrichmentResponse> {
  const address = ipaddr.process(input.ip)
  const ip = address.toString()
  const isPublic = address.range() === 'unicast'
  const geo = isPublic ? lookup(ip) : null
  const headers = { ...input.client_hints, 'user-agent': input.user_agent }
  const parsed = await new UAParser(headers).getResult().withClientHints()
  const bot = isBot(input.user_agent)
  const detectedType = deviceTypeSchema.safeParse(parsed.device.type)
  const desktop =
    !bot && parsed.browser.name && parsed.os.name && desktopSystems.has(parsed.os.name)

  return {
    device_type: detectedType.success ? detectedType.data : desktop ? 'desktop' : 'unknown',
    device_model: parsed.device.model ?? null,
    browser: parsed.browser.name ?? null,
    os: parsed.os.name ?? null,
    country_code: geo?.country_code ?? null,
    city: geo?.city ?? null,
  }
}
