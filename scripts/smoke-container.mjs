import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import { createConnection } from 'node:net'

assert.match(readFileSync('/etc/os-release', 'utf8'), /ID=alpine/)
assert.notEqual(process.getuid(), 0)
assert.match(readFileSync('LICENSE', 'utf8'), /GNU AFFERO GENERAL PUBLIC LICENSE/)
assert.match(
  readFileSync('NOTICE', 'utf8'),
  /This product includes GeoLite Data created by MaxMind/,
)

const server = spawn(process.execPath, ['dist/server.js'], { stdio: 'inherit' })
const exited = once(server, 'exit')
const base = 'http://127.0.0.1:3000'
const request = (path, init) =>
  fetch(`${base}${path}`, { signal: AbortSignal.timeout(5_000), ...init })
let stalledConnection

try {
  let ready = false
  const deadline = Date.now() + 150_000
  while (Date.now() < deadline) {
    assert.equal(server.exitCode, null, 'Session Insight exited before becoming ready')
    assert.equal(server.signalCode, null, 'Session Insight was killed before becoming ready')
    try {
      ready = (await fetch(`${base}/health`, { signal: AbortSignal.timeout(1000) })).ok
    } catch {
      // The server may still be loading its GeoIP database.
    }
    if (ready) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.ok(ready, 'Session Insight did not become ready')

  const response = await request('/api/enrich', {
    method: 'POST',
    headers: { 'content-type': 'application/json ; charset=utf-8' },
    body: JSON.stringify({
      ip: '8.8.8.8',
      user_agent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    }),
  })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const result = await response.json()
  assert.deepEqual(Object.keys(result).toSorted(), [
    'browser',
    'city',
    'country_code',
    'device_model',
    'device_type',
    'os',
  ])
  assert.equal(result.device_type, 'desktop')
  assert.equal(result.browser, 'Chrome')
  assert.ok(result.country_code)

  const ipv6 = await request('/api/enrich', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ip: '2001:4860:4860::8888', user_agent: '' }),
  })
  assert.equal(ipv6.status, 200)
  assert.ok((await ipv6.json()).country_code)

  const invalid = await request('/api/enrich', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ip: 'invalid', user_agent: '' }),
  })
  assert.equal(invalid.status, 400)
  assert.match(invalid.headers.get('content-type'), /application\/problem\+json/)

  const spec = await (await request('/api/openapi.json')).json()
  assert.equal(spec.info.title, 'Session Insight')
  assert.equal(spec.info.version, JSON.parse(readFileSync('package.json', 'utf8')).version)
  assert.equal(spec.paths['/api/enrich'].post.operationId, 'enrichSession')
  assert.equal((await request('/api/docs/')).status, 404)
  console.log(
    'Container smoke test passed: Alpine, non-root, health, IPv4/IPv6 enrichment, validation, and OpenAPI.',
  )

  // An incomplete request must not keep the process alive indefinitely on shutdown.
  stalledConnection = createConnection({ host: '127.0.0.1', port: 3000 })
  stalledConnection.on('error', () => {})
  await once(stalledConnection, 'connect', { signal: AbortSignal.timeout(5_000) })
  stalledConnection.write(
    'POST /api/enrich HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 1000\r\nExpect: 100-continue\r\n\r\n',
  )
  const [continueResponse] = await once(stalledConnection, 'data', {
    signal: AbortSignal.timeout(5_000),
  })
  assert.match(continueResponse.toString(), /100 Continue/)
  stalledConnection.write('{"ip":')
} finally {
  server.kill('SIGTERM')
  const timeout = setTimeout(() => server.kill('SIGKILL'), 8_000)
  try {
    const [code, signal] = await exited
    assert.equal(code, 0)
    assert.equal(signal, null)
    console.log('Graceful shutdown with an incomplete request passed.')
  } finally {
    clearTimeout(timeout)
    stalledConnection?.destroy()
  }
}
