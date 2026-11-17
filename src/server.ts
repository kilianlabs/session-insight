import { serve } from '@hono/node-server'
import type { ServerType } from '@hono/node-server'
import { buildApp } from './app.ts'
import { readConfig } from './config.ts'
import { openGeoDatabase } from './geoip.ts'
import { logger } from './logging.ts'

logger.info('Starting Session Insight')
const controller = new AbortController()
let database: Awaited<ReturnType<typeof openGeoDatabase>> | undefined
let server: ServerType | undefined

function shutdown(signal: NodeJS.Signals) {
  if (controller.signal.aborted) return
  logger.info({ signal }, 'Stopping Session Insight')
  controller.abort()
  void database?.close()
  if (!server) return

  // Drain active requests, but finish before Docker's default stop timeout.
  const timeout = setTimeout(() => {
    if (server && 'closeAllConnections' in server) server.closeAllConnections()
  }, 5_000).unref()
  server.close((error) => {
    clearTimeout(timeout)
    if (error) {
      logger.error({ error }, 'Failed to close Session Insight')
      process.exitCode = 1
      return
    }
    logger.info('Session Insight HTTP server stopped')
  })
}

// Register before the first download so startup can also be interrupted cleanly.
process.once('SIGINT', () => shutdown('SIGINT'))
process.once('SIGTERM', () => shutdown('SIGTERM'))

try {
  const config = readConfig()
  database = await openGeoDatabase({
    directory: config.GEOIP_DATABASE_DIR,
    signal: controller.signal,
  })
  if (controller.signal.aborted) {
    await database.close()
  } else {
    const app = buildApp({ lookup: database.lookup, isReady: database.isReady })
    server = serve(
      {
        fetch: app.fetch,
        hostname: config.HOST,
        port: config.PORT,
        serverOptions: { requestTimeout: 30_000, headersTimeout: 10_000, keepAliveTimeout: 5_000 },
      },
      (info) => {
        const address = info.family === 'IPv6' ? `[${info.address}]` : info.address
        logger.info({ address: `http://${address}:${info.port}` }, 'Session Insight listening')
      },
    )

    server.on('error', (error) => {
      logger.error({ error }, 'Failed to start Session Insight')
      process.exitCode = 1
      void database?.close()
    })
  }
} catch (error) {
  if (!controller.signal.aborted) {
    logger.error({ error }, 'Failed to start Session Insight')
    process.exitCode = 1
  }
  await database?.close()
}
