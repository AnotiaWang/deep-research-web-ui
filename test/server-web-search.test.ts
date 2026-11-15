import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { it } from 'node:test'
import type { RuntimeConfig } from 'nuxt/schema'

// Nitro supplies this global when loading the route in production.
const globals = globalThis as any
const previousHandler = globals.defineEventHandler
globals.defineEventHandler = (handler: unknown) => handler
const { createServerWebSearch } = await import('../server/api/research.post.ts')
if (previousHandler === undefined) delete globals.defineEventHandler
else globals.defineEventHandler = previousHandler

function config(apiKey?: string, provider = 'youcom') {
  return {
    public: { webSearchProvider: provider },
    webSearchApiKey: apiKey,
  } as RuntimeConfig
}

it('uses keyless You.com search without creating a key pool when no key is configured', async () => {
  const previous = globalThis.fetch
  const requests: URL[] = []
  globalThis.fetch = async (input, init) => {
    requests.push(new URL(String(input)))
    assert.equal(new Headers(init?.headers).has('X-API-Key'), false)
    return Response.json({
      results: { web: [{ url: 'https://example.com', description: 'Result' }] },
    })
  }
  try {
    for (const key of [undefined, '', '   ']) {
      const results = await createServerWebSearch(config(key))('Nuxt', {})
      assert.equal(results[0]?.content, 'Result')
    }
    assert.equal(requests.length, 3)
    assert.ok(
      requests.every(
        (url) => url.origin === 'https://api.you.com' && url.pathname === '/v1/agents/search',
      ),
    )
  } finally {
    globalThis.fetch = previous
  }
})

it('rotates configured You.com keys and does not silently switch to keyless when all are disabled', async () => {
  const previous = globalThis.fetch
  const previousCwd = process.cwd()
  const cacheRoot = mkdtempSync(path.join(tmpdir(), 'youcom-keypool-test-'))
  const keys: (string | null)[] = []
  let fail = false
  globalThis.fetch = async (input, init) => {
    assert.equal(new URL(String(input)).hostname, 'ydc-index.io')
    keys.push(new Headers(init?.headers).get('X-API-Key'))
    return fail ? new Response('', { status: 401 }) : Response.json({ results: { web: [] } })
  }
  process.chdir(cacheRoot)
  try {
    const search = createServerWebSearch(config('test-key-one, test-key-two'))
    await search('Nuxt', {})
    await search('Nuxt', {})
    assert.deepEqual(keys, ['test-key-one', 'test-key-two'])
    fail = true
    for (let index = 0; index < 10; index++) {
      await assert.rejects(() => search('Nuxt', {}), /HTTP 401/)
    }
    const requestCount = keys.length
    await assert.rejects(() => search('Nuxt', {}), /No active You.com API keys available/)
    assert.equal(keys.length, requestCount)
  } finally {
    globalThis.fetch = previous
    process.chdir(previousCwd)
    rmSync(cacheRoot, { recursive: true, force: true })
  }
})

it('rotates configured Serply keys and stops once every key is disabled', async () => {
  const previous = globalThis.fetch
  const previousCwd = process.cwd()
  const cacheRoot = mkdtempSync(path.join(tmpdir(), 'serply-keypool-test-'))
  const keys: (string | null)[] = []
  let fail = false
  globalThis.fetch = async (input, init) => {
    assert.equal(new URL(String(input)).hostname, 'api.serply.io')
    keys.push(new Headers(init?.headers).get('X-Api-Key'))
    return fail
      ? Response.json({ detail: 'Invalid API key' }, { status: 401 })
      : Response.json({ results: [] })
  }
  process.chdir(cacheRoot)
  try {
    const search = createServerWebSearch(config('test-key-one, test-key-two', 'serply'))
    await search('Nuxt', {})
    await search('Nuxt', {})
    assert.deepEqual(keys, ['test-key-one', 'test-key-two'])
    fail = true
    for (let index = 0; index < 10; index++) {
      await assert.rejects(() => search('Nuxt', {}), /Invalid API key/)
    }
    const requestCount = keys.length
    await assert.rejects(() => search('Nuxt', {}), /No active Serply API keys available/)
    assert.equal(keys.length, requestCount)
  } finally {
    globalThis.fetch = previous
    process.chdir(previousCwd)
    rmSync(cacheRoot, { recursive: true, force: true })
  }
})

it('uses keyless Keenable search and source reading without a key pool when no key is configured', async () => {
  const previous = globalThis.fetch
  const requests: { url: URL; headers: Headers }[] = []
  globalThis.fetch = async (input, init) => {
    requests.push({ url: new URL(String(input)), headers: new Headers(init?.headers) })
    return requests.at(-1)!.url.pathname.startsWith('/v1/fetch')
      ? Response.json({ url: 'https://example.com', content: 'Page body' })
      : Response.json({ results: [{ url: 'https://example.com', snippet: 'Result' }] })
  }
  try {
    for (const key of [undefined, '', '   ']) {
      const search = createServerWebSearch(config(key, 'keenable'))
      const results = await search('Nuxt', {})
      assert.equal(results[0]?.content, 'Result')
      const page = await search.readSource!('https://example.com', {})
      assert.equal(page?.content, 'Page body')
    }
    assert.equal(requests.length, 6)
    assert.ok(
      requests.every(
        ({ url, headers }) =>
          url.origin === 'https://api.keenable.ai' &&
          url.pathname.endsWith('/public') &&
          !headers.has('X-API-Key') &&
          headers.get('X-Keenable-Title') === 'deep-research-web-ui',
      ),
    )
  } finally {
    globalThis.fetch = previous
  }
})

it('rotates configured Keenable keys and does not silently switch to keyless when all are disabled', async () => {
  const previous = globalThis.fetch
  const previousCwd = process.cwd()
  const cacheRoot = mkdtempSync(path.join(tmpdir(), 'keenable-keypool-test-'))
  const keys: (string | null)[] = []
  let fail = false
  globalThis.fetch = async (input, init) => {
    assert.equal(new URL(String(input)).href, 'https://api.keenable.ai/v1/search')
    keys.push(new Headers(init?.headers).get('X-API-Key'))
    return fail
      ? Response.json({ message: 'Malformed API key' }, { status: 401 })
      : Response.json({ results: [] })
  }
  process.chdir(cacheRoot)
  try {
    const search = createServerWebSearch(config('test-key-one, test-key-two', 'keenable'))
    await search('Nuxt', {})
    await search('Nuxt', {})
    assert.deepEqual(keys, ['test-key-one', 'test-key-two'])
    fail = true
    for (let index = 0; index < 10; index++) {
      await assert.rejects(() => search('Nuxt', {}), /HTTP 401/)
    }
    const requestCount = keys.length
    await assert.rejects(() => search('Nuxt', {}), /No active Keenable API keys available/)
    assert.equal(keys.length, requestCount)
  } finally {
    globalThis.fetch = previous
    process.chdir(previousCwd)
    rmSync(cacheRoot, { recursive: true, force: true })
  }
})
