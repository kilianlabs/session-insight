import { fileURLToPath } from 'node:url'
import SwaggerParser from '@apidevtools/swagger-parser'
import { describe, expect, it, vi } from 'vitest'
import { buildApp, openApiConfig } from '../app.ts'
import type { GeoLookup } from '../geoip.ts'
import { enrichmentResponseSchema, problemSchema } from '../schemas.ts'
import { berlin, iphoneSafari, windowsChrome } from './fixtures.ts'

describe('HTTP API', () => {
  const lookup = vi.fn<GeoLookup>(() => berlin)
  const app = buildApp({ lookup })

  it('enriches the explicit input rather than the backend connection headers', async () => {
    const response = await app.request('/api/enrich', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': iphoneSafari,
        'x-forwarded-for': '10.0.0.1',
        'sec-ch-ua-mobile': '?1',
      },
      body: JSON.stringify({
        ip: '8.8.8.8',
        user_agent: windowsChrome,
      }),
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const result = await response.json()
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
    {},
    { ip: '8.8.8.8' },
    { ip: 'not-an-ip', user_agent: '' },
    { ip: '8.8.8.8:443', user_agent: '' },
    { ip: '8.8.8.8, 1.1.1.1', user_agent: '' },
    { ip: 'fe80::1%eth0', user_agent: '' },
    { ip: '127.1', user_agent: '' },
    { ip: '010.0.0.1', user_agent: '' },
    { ip: '8.8.8.8', user_agent: 12 },
    { ip: '8.8.8.8', user_agent: 'a'.repeat(4097) },
    { ip: '8.8.8.8', user_agent: '', userAgent: 'typo' },
    { ip: '8.8.8.8', user_agent: '', client_hints: { 'user-agent': 'override' } },
    { ip: '8.8.8.8', user_agent: '', client_hints: { 'sec-ch-ua-mobile': true } },
    { ip: '8.8.8.8', user_agent: '', client_hints: { 'sec-ch-ua-arch': '"arm"' } },
    { ip: '8.8.8.8', user_agent: '', metadata: { session_id: 'unnecessary-context' } },
  ])('rejects invalid input %# before GeoIP lookup', async (payload) => {
    lookup.mockClear()
    const response = await app.request('/api/enrich', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    expect(response.status).toBe(400)
    expect(response.headers.get('content-type')).toContain('application/problem+json')
    expect(problemSchema.parse(await response.json()).status).toBe(400)
    expect(lookup).not.toHaveBeenCalled()
  })

  it('rejects malformed JSON and unsupported content types with problem responses', async () => {
    for (const [contentType, payload, status] of [
      ['application/json', '{invalid-json', 400],
      ['text/html', '<html></html>', 415],
    ] as const) {
      const response = await app.request('/api/enrich', {
        method: 'POST',
        headers: { 'content-type': contentType },
        body: payload,
      })
      expect(response.status).toBe(status)
      expect(response.headers.get('content-type')).toContain('application/problem+json')
      expect(problemSchema.parse(await response.json()).status).toBe(status)
    }
  })

  it.each([
    'Application/JSON',
    'application/json; charset=utf-8',
    'application/json ; charset="utf-8"',
  ])('accepts JSON with content type %s', async (contentType) => {
    const response = await app.request('/api/enrich', {
      method: 'POST',
      headers: { 'content-type': contentType },
      body: JSON.stringify({ ip: '8.8.8.8', user_agent: windowsChrome }),
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ browser: 'Chrome', city: 'Berlin' })
  })

  it('validates JSON with content-type parameters before enrichment', async () => {
    lookup.mockClear()
    const response = await app.request('/api/enrich', {
      method: 'POST',
      headers: { 'content-type': 'application/json ; charset=utf-8' },
      body: JSON.stringify({ ip: 'invalid', user_agent: '' }),
    })
    expect(response.status).toBe(400)
    expect(lookup).not.toHaveBeenCalled()
  })

  it('rejects an oversized request before enrichment', async () => {
    const response = await app.request('/api/enrich', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ip: '8.8.8.8', user_agent: 'a'.repeat(33 * 1024) }),
    })
    expect(response.status).toBe(413)
    expect(problemSchema.parse(await response.json()).status).toBe(413)
  })

  it('does not expose internal failures or caller data', async () => {
    const failingApp = buildApp({
      lookup: () => {
        throw new Error('secret failure details')
      },
    })
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const response = await failingApp.request('/api/enrich', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ip: '8.8.8.8', user_agent: windowsChrome }),
      })
      expect(response.status).toBe(500)
      expect(problemSchema.parse(await response.json())).toEqual({
        type: 'urn:session-insight:error:internal',
        title: 'Internal Server Error',
        status: 500,
        detail: 'Session enrichment failed.',
      })
      expect(errorLog).toHaveBeenCalledExactlyOnceWith('Session enrichment failed')
    } finally {
      errorLog.mockRestore()
    }
  })

  it('serves health without an interactive documentation UI', async () => {
    const health = await app.request('/health')
    expect(health.status).toBe(200)
    expect(await health.json()).toEqual({ status: 'ok' })
    const docs = await app.request('/api/docs/')
    expect(docs.status).toBe(404)
  })

  it('returns a problem response for unknown endpoints', async () => {
    const response = await app.request('/missing')
    expect(response.status).toBe(404)
    expect(problemSchema.parse(await response.json()).status).toBe(404)
  })

  it('reports unavailable GeoIP data without serving incomplete enrichment', async () => {
    const unavailableLookup = vi.fn<GeoLookup>(() => berlin)
    const unavailableApp = buildApp({ lookup: unavailableLookup, isReady: () => false })
    const health = await unavailableApp.request('/health')
    expect(health.status).toBe(503)
    const enrichment = await unavailableApp.request('/api/enrich', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ip: '8.8.8.8', user_agent: '' }),
    })
    expect(enrichment.status).toBe(503)
    expect(problemSchema.parse(await enrichment.json()).type).toBe(
      'urn:session-insight:error:unavailable',
    )
    expect(unavailableLookup).not.toHaveBeenCalled()
    expect((await unavailableApp.request('/api/openapi.json')).status).toBe(200)
  })

  it('publishes a valid OpenAPI contract with named schemas and actual response media types', async () => {
    const response = await app.request('/api/openapi.json')
    expect(response.status).toBe(200)
    const document = await response.json()
    await expect(
      SwaggerParser.validate(fileURLToPath(new URL('../../openapi.json', import.meta.url))),
    ).resolves.toBeDefined()
    expect(document).toEqual(app.getOpenAPIDocument(openApiConfig))
    expect(document).toHaveProperty('components.schemas.EnrichmentResponse.properties', {
      browser: expect.any(Object),
      city: expect.any(Object),
      country_code: expect.any(Object),
      device_model: expect.any(Object),
      device_type: expect.any(Object),
      os: expect.any(Object),
    })
    expect(document).toHaveProperty(
      'components.schemas.EnrichmentResponse.additionalProperties',
      false,
    )
    expect(document).toMatchObject({
      openapi: '3.0.3',
      paths: {
        '/api/enrich': {
          post: {
            operationId: 'enrichSession',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/EnrichmentRequestInput' },
                },
              },
            },
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/EnrichmentResponse' },
                  },
                },
              },
              '400': {
                content: {
                  'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } },
                },
              },
            },
          },
        },
      },
    })
  })
})
