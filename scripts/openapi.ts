import { readFile, writeFile } from 'node:fs/promises'
import { buildApp, openApiConfig } from '../src/app.ts'

const path = new URL('../openapi.json', import.meta.url)
const document = `${JSON.stringify(buildApp({ lookup: () => null }).getOpenAPIDocument(openApiConfig), null, 2)}\n`
if (process.argv.includes('--check')) {
  const saved = await readFile(path, 'utf8')
  if (saved !== document) {
    throw new Error('openapi.json is out of date. Run pnpm openapi.')
  }
} else {
  await writeFile(path, document)
}
