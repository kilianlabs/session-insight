import { z } from '@hono/zod-openapi'

const ipAddress = z
  .union([z.ipv4(), z.ipv6()])
  .describe('A single IPv4 or IPv6 address, without a port, zone ID, or proxy chain.')
const hint = z.string().max(2048)

const clientHintsSchema = z
  .strictObject({
    'sec-ch-ua': hint.optional(),
    'sec-ch-ua-full-version-list': hint.optional(),
    'sec-ch-ua-mobile': z.enum(['?0', '?1']).optional(),
    'sec-ch-ua-model': hint.optional(),
    'sec-ch-ua-platform': hint.optional(),
    'sec-ch-ua-form-factors': hint.optional(),
  })
  .openapi('ClientHints')

export const enrichmentRequestSchema = z
  .strictObject({
    ip: ipAddress,
    user_agent: z
      .string()
      .max(4096)
      .describe(
        'Original browser User-Agent. Empty is allowed. UAParser.js analyzes at most the first 500 characters.',
      ),
    client_hints: clientHintsSchema
      .optional()
      .describe(
        'Original browser Client Hint headers, using lowercase header names and unmodified values.',
      ),
  })
  .openapi('EnrichmentRequestInput')

export const deviceTypeSchema = z.enum([
  'desktop',
  'mobile',
  'tablet',
  'smarttv',
  'console',
  'wearable',
  'embedded',
  'xr',
  'unknown',
])

const nullableText = z.string().nullable()

export const enrichmentResponseSchema = z
  .strictObject({
    device_type: deviceTypeSchema.describe(
      'Device category for a session icon. Desktop is inferred only for a recognized desktop OS and browser.',
    ),
    device_model: nullableText.describe('Recognizable device model, when available.'),
    browser: nullableText.describe('Browser name, without a version.'),
    os: nullableText.describe('Operating system name, without a version.'),
    country_code: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .nullable()
      .describe(
        'ISO 3166-1 alpha-2 country code for localization by the caller. Null for non-public addresses or unavailable country data.',
      ),
    city: nullableText.describe(
      'Approximate city name. Null for non-public addresses or unavailable city data.',
    ),
  })
  .openapi('EnrichmentResponse')

export const problemSchema = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.number().int(),
    detail: z.string(),
  })
  .openapi('Problem')

export const healthSchema = z.object({ status: z.literal('ok') }).openapi('Health')

export type EnrichmentRequest = z.infer<typeof enrichmentRequestSchema>
export type EnrichmentResponse = z.infer<typeof enrichmentResponseSchema>
export type Location = Pick<EnrichmentResponse, 'country_code' | 'city'>
