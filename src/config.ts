import { z } from 'zod'

const configSchema = z.object({
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z
    .string()
    .regex(/^\d+$/)
    .default('3000')
    .pipe(z.coerce.number<string>().int().min(1).max(65535)),
  GEOIP_DATABASE_DIR: z.string().min(1).default('geoip-data'),
})

export function readConfig(environment: NodeJS.ProcessEnv = process.env) {
  return configSchema.parse(environment)
}
