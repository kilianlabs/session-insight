import { once } from 'node:events'
import { serve } from '@hono/node-server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MockInstance } from 'vitest'
import { z } from 'zod'
import { buildApp } from '../app.ts'
import { logger } from '../logging.ts'

const payload = JSON.stringify({
  ip: '8.8.8.8',
  user_agent: 'secret-user-agent',
  client_hints: { 'sec-ch-ua-model': 'secret-model' },
})

const logRecord = z.looseObject({
  time: z.iso.datetime(),
  level: z.enum(['INFO', 'WARN', 'ERROR']),
  msg: z.string(),
  service: z.literal('session-insight'),
})

let logOutput: MockInstance<typeof process.stdout.write>

function records() {
  return logOutput.mock.calls.map(([chunk]) => {
    expect(typeof chunk).toBe('string')
    expect(String(chunk)).toMatch(/\n$/)
    const line = String(chunk).slice(0, -1)
    expect(line).not.toContain('\n')
    return logRecord.parse(JSON.parse(line))
  })
}

describe('structured logging', () => {
  beforeEach(() => {
    logOutput = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('writes JSON records to stdout, including escaped operational error details', () => {
    logger.info('Starting Session Insight')
    logger.warn({ error: new Error('connection\nfailed') }, 'GeoLite update failed')
    logger.error({ error: new Error('address in use') }, 'Failed to start Session Insight')
    expect(records()).toEqual([
      expect.objectContaining({ level: 'INFO', msg: 'Starting Session Insight' }),
      expect.objectContaining({
        level: 'WARN',
        msg: 'GeoLite update failed',
        error: expect.objectContaining({
          type: 'Error',
          message: 'connection\nfailed',
          stack: expect.any(String),
        }),
      }),
      expect.objectContaining({
        level: 'ERROR',
        msg: 'Failed to start Session Insight',
        error: expect.objectContaining({ message: 'address in use' }),
      }),
    ])
    for (const record of records()) {
      expect(record.service).toBe('session-insight')
      expect(new Date(record.time).toISOString()).toBe(record.time)
      expect(record).not.toHaveProperty('request_id')
    }
  })

  it.each([
    ['GET', '/health', undefined, 200],
    ['HEAD', '/health', undefined, 200],
    ['GET', '/api/openapi.json', undefined, 200],
    ['POST', '/api/enrich', payload, 200],
    ['POST', '/api/enrich?token=secret-query', '{invalid-json', 400],
    ['POST', '/api/enrich', '{}', 400],
    ['POST', '/api/enrich', 'a'.repeat(33 * 1024), 413],
    ['POST', '/api/enrich', payload, 415],
    ['GET', '/missing?token=secret-query', undefined, 404],
    ['GET', '/api/enrich', undefined, 404],
  ] as const)('logs %s %s (case %#)', async (method, path, body, status) => {
    const app = buildApp({ lookup: () => ({ country_code: 'DE', city: 'München' }) })
    const response = await app.request(path, {
      method,
      headers: {
        'content-type': status === 415 ? 'text/plain' : 'application/json',
        'x-request-id': 'upstream/request-123',
        authorization: 'Bearer secret-token',
        cookie: 'session=secret-cookie',
        'user-agent': 'secret-transport-agent',
        'x-forwarded-for': 'secret-forwarded-ip',
      },
      body,
    })
    expect(response.status).toBe(status)
    expect(response.headers.get('x-request-id')).toBe('upstream/request-123')
    const logs = records()
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({
      service: 'session-insight',
      level: 'INFO',
      msg: 'HTTP request',
      event: 'http_request',
      request_id: 'upstream/request-123',
      method,
      path: path.split('?')[0],
      status,
      duration_ms: expect.any(Number),
      size: (await response.arrayBuffer()).byteLength,
    })
    expect(logs[0]?.duration_ms).toBeGreaterThanOrEqual(0)
    expect(JSON.stringify(logs)).not.toMatch(/secret-|8\.8\.8\.8|München|country_code/)
  })

  it.each([undefined, '', 'upstream/request-123'])(
    'correlates sanitized failures and access logs with request ID %j',
    async (suppliedId) => {
      const app = buildApp({
        lookup: () => {
          throw new Error(`secret-parser-details: ${payload}`)
        },
      })
      const ids = new Set<string>()
      const generatedId = expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      )
      const expectedId = suppliedId || generatedId
      for (let attempt = 0; attempt < 2; attempt++) {
        logOutput.mockClear()
        const headers = new Headers({ 'content-type': 'application/json' })
        if (suppliedId !== undefined) headers.set('x-request-id', suppliedId)
        const response = await app.request('/api/enrich', {
          method: 'POST',
          headers,
          body: payload,
        })
        expect(response.status).toBe(500)
        const id = response.headers.get('x-request-id')!
        expect(id).toEqual(expectedId)
        ids.add(id)
        const logs = records()
        expect(logs).toHaveLength(2)
        expect(logs[0]).toMatchObject({
          level: 'ERROR',
          operation: 'enrich',
          error_type: 'urn:session-insight:error:internal',
          status: 500,
          request_id: id,
        })
        expect(logs[1]).toMatchObject({ event: 'http_request', status: 500, request_id: id })
        expect(JSON.stringify(logs)).not.toMatch(/secret-|8\.8\.8\.8/)
        expect(await response.text()).not.toMatch(/secret-|8\.8\.8\.8/)
      }
      expect(ids.size).toBe(suppliedId ? 1 : 2)
    },
  )

  it('logs unavailable health and enrichment responses', async () => {
    const app = buildApp({ lookup: () => null, isReady: () => false })
    await app.request('/health')
    await app.request('/api/enrich', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload,
    })
    expect(records()).toEqual([
      expect.objectContaining({ event: 'http_request', path: '/health', status: 503 }),
      expect.objectContaining({ event: 'http_request', path: '/api/enrich', status: 503 }),
    ])
  })

  it('keeps IDs separate across concurrent enrichment requests', async () => {
    const app = buildApp({ lookup: () => null })
    const ids = Array.from({ length: 12 }, (_, index) => `request-${index}`)
    const responses = await Promise.all(
      ids.map(async (id) =>
        app.request('/api/enrich', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-request-id': id },
          body: payload,
        }),
      ),
    )
    expect(responses.map((response) => response.headers.get('x-request-id'))).toEqual(ids)
    expect(records()).toHaveLength(ids.length)
    expect(records().map((record) => record.request_id)).toEqual(expect.arrayContaining(ids))
    logger.info('Background update')
    expect(records().at(-1)).not.toHaveProperty('request_id')
  })

  it('logs the transport protocol and UTF-8 response size through the Node server', async () => {
    const app = buildApp({ lookup: () => ({ country_code: 'DE', city: 'München' }) })
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 })
    try {
      await once(server, 'listening')
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Expected TCP listener')
      const response = await fetch(`http://127.0.0.1:${address.port}/api/enrich`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-request-id': 'node-request' },
        body: payload,
      })
      const body = await response.text()
      expect(response.status).toBe(200)
      expect(body).toContain('München')
      expect(records()).toEqual([
        expect.objectContaining({
          proto: 'HTTP/1.1',
          size: Buffer.byteLength(body),
          request_id: 'node-request',
        }),
      ])
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    }
  })
})
