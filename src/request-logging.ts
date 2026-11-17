import { randomUUID } from 'node:crypto'
import type { HttpBindings } from '@hono/node-server'
import { createMiddleware } from 'hono/factory'
import type { Logger } from 'pino'
import { logger } from './logging.ts'

export type LoggingEnv = {
  Bindings: Partial<HttpBindings>
  Variables: { logger: Logger }
}

export const logRequests = createMiddleware<LoggingEnv>(async (c, next) => {
  const started = performance.now()
  const requestId = c.req.header('X-Request-ID') || randomUUID()
  const requestLogger = logger.child({ request_id: requestId })
  c.set('logger', requestLogger)
  c.header('X-Request-ID', requestId)

  await next()

  const duration = performance.now() - started
  // All routes return small, buffered JSON bodies. Read a clone to count UTF-8
  // bytes without consuming the caller's response; HEAD has no response body.
  const size = c.req.method === 'HEAD' ? 0 : (await c.res.clone().arrayBuffer()).byteLength
  const httpVersion = c.env?.incoming?.httpVersion
  requestLogger.info(
    {
      event: 'http_request',
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      duration_ms: Math.round(duration),
      proto: httpVersion ? `HTTP/${httpVersion}` : undefined,
      size,
    },
    'HTTP request',
  )
})
