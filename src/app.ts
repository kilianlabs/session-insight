import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import type { Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { HTTPException } from 'hono/http-exception'
import packageJson from '../package.json' with { type: 'json' }
import { enrichSession } from './enrich.ts'
import type { GeoLookup } from './geoip.ts'
import {
  enrichmentRequestSchema,
  enrichmentResponseSchema,
  healthSchema,
  problemSchema,
} from './schemas.ts'

export const openApiConfig = {
  openapi: '3.0.3',
  info: {
    title: 'Session Insight',
    version: packageJson.version,
    license: {
      name: 'AGPL-3.0-only',
      url: 'https://github.com/kilianlabs/session-insight/blob/main/LICENSE',
    },
    description:
      'Stateless session enrichment with local GeoIP data and UAParser.js. Intended for a trusted internal network.',
  },
}

export function buildApp(options: { lookup: GeoLookup; isReady?: () => boolean }) {
  const app = new OpenAPIHono({
    defaultHook: (result, c) => (result.success ? undefined : problem(c, 400)),
  })

  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    await next()
  })
  app.onError((error, c) => {
    if (error instanceof HTTPException && error.status === 400) return problem(c, 400)
    // Never log input, parser exceptions, or response payloads containing session data.
    console.error('Session enrichment failed')
    return problem(c, 500)
  })
  app.notFound((c) => problem(c, 404))

  const problemResponse = {
    description: 'Request or enrichment failure.',
    content: { 'application/problem+json': { schema: problemSchema } },
  }

  app.openapi(
    createRoute({
      method: 'get',
      path: '/health',
      operationId: 'getHealth',
      summary: 'Check that the sidecar has a usable GeoIP database',
      responses: {
        200: {
          description: 'The sidecar is ready to enrich sessions.',
          content: { 'application/json': { schema: healthSchema } },
        },
        503: problemResponse,
      },
    }),
    (c) =>
      options.isReady?.() === false ? problem(c, 503) : c.json({ status: 'ok' as const }, 200),
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/enrich',
      operationId: 'enrichSession',
      summary: 'Enrich an IP address and User-Agent',
      description:
        'Return only the device, browser, OS, city, and country details needed for session history. Pass the original session client information in the body; transport and proxy headers are not used. Unknown values are null except device_type, which is unknown. Non-public IPs and database misses have null city and country_code.',
      middleware: [
        bodyLimit({ maxSize: 32 * 1024, onError: (c) => problem(c, 413) }),
        async (c, next) => {
          const mediaType = c.req.header('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
          if (mediaType !== 'application/json') return problem(c, 415)
          // Use the same media type for Hono's JSON validator, including when parameters
          // contain whitespace that its content-type matcher does not recognize.
          c.req.raw.headers.set('content-type', 'application/json')
          return next()
        },
      ] as const,
      request: {
        body: {
          required: true,
          content: { 'application/json': { schema: enrichmentRequestSchema } },
        },
      },
      responses: {
        200: {
          description: 'Enriched session information.',
          content: { 'application/json': { schema: enrichmentResponseSchema } },
        },
        400: problemResponse,
        413: problemResponse,
        415: problemResponse,
        500: problemResponse,
        503: problemResponse,
      },
    }),
    async (c) => {
      if (options.isReady?.() === false) return problem(c, 503)
      const result = await enrichSession(c.req.valid('json'), options.lookup)
      return c.json(enrichmentResponseSchema.parse(result), 200)
    },
  )

  app.doc('/api/openapi.json', openApiConfig)
  return app
}

function problem<Status extends 400 | 404 | 413 | 415 | 500 | 503>(c: Context, status: Status) {
  const descriptions = {
    400: [
      'Bad Request',
      'The request must be valid JSON matching the enrichment request schema in the OpenAPI specification.',
    ],
    404: ['Not Found', 'The requested endpoint does not exist.'],
    413: ['Payload Too Large', 'The request body exceeds 32 KiB.'],
    415: ['Unsupported Media Type', 'Send the request as application/json.'],
    500: ['Internal Server Error', 'Session enrichment failed.'],
    503: ['Service Unavailable', 'GeoIP data is temporarily unavailable.'],
  } as const
  const [title, detail] = descriptions[status]
  const code =
    status === 503
      ? 'unavailable'
      : status === 500
        ? 'internal'
        : status === 404
          ? 'not-found'
          : 'invalid-request'
  return c.json({ type: `urn:session-insight:error:${code}`, title, status, detail }, status, {
    'Content-Type': 'application/problem+json',
  })
}
