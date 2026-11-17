import { pino } from 'pino'

export const logger = pino(
  {
    base: { service: 'session-insight' },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label.toUpperCase() }) },
    serializers: { error: pino.stdSerializers.err },
  },
  process.stdout,
)
