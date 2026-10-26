import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, describe, it } from 'node:test'
import { existsSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { isAccessPasswordValid } from '../server/utils/access.ts'

type H3 = typeof import('h3')

/**
 * h3 is not a direct dependency (Nitro supplies it), so it is loaded from the pnpm store the same
 * way a consumer would resolve it rather than through a top-level `import`.
 */
async function loadH3(): Promise<H3> {
  const manifest = `${process.cwd()}/node_modules/.pnpm/node_modules/h3/package.json`
  assert.ok(existsSync(manifest), 'h3 must be present in the pnpm store')
  const { version } = JSON.parse(readFileSync(manifest, 'utf8')) as { version: string }
  const dist = `${process.cwd()}/node_modules/.pnpm/h3@${version}/node_modules/h3/dist/index.mjs`
  assert.ok(existsSync(dist), `h3 ${version} dist entry must exist`)
  return import(pathToFileURL(dist).href) as Promise<H3>
}

const PASSWORD = 's3cret'
const GUARDED_ROUTES = ['feedback', 'research', 'report'] as const

/** Wires up the Nuxt auto-imports that the real server modules expect. */
function installServerGlobals(
  h3: H3,
  {
    accessPassword = PASSWORD,
    serverMode = true,
  }: { accessPassword?: string; serverMode?: boolean } = {},
) {
  Object.assign(globalThis, {
    useRuntimeConfig: () => ({ accessPassword, public: { serverMode } }),
    getHeader: (event: any, name: string) => h3.getRequestHeader(event, name),
    getRequestURL: h3.getRequestURL,
    defineEventHandler: h3.defineEventHandler,
    createError: (options: any) =>
      Object.assign(new Error(options.statusMessage), {
        statusCode: options.statusCode,
        statusMessage: options.statusMessage,
      }),
  })
}

interface Harness {
  baseUrl: string
  reached: string[]
  close: () => Promise<void>
}

/**
 * Serves the real middleware plus a stand-in for each money-spending route.
 *
 * Nitro mounts middleware at `app.baseURL`, which h3 strips from `event.path` before the handler
 * runs; `basePath` reproduces that so both mount points are covered.
 */
async function startHarness(h3: H3, middleware: any, basePath = '/'): Promise<Harness> {
  const reached: string[] = []
  const mount = (route: string) => (basePath === '/' ? route : `${basePath}${route.slice(1)}`)
  const app = h3.createApp()
  if (basePath === '/') app.use(middleware)
  else app.use(basePath, middleware)
  // The stand-ins deliberately do *not* re-assert access: these cases prove the middleware layer
  // stops the request on its own.
  for (const name of GUARDED_ROUTES) {
    app.use(
      mount(`/api/${name}`),
      h3.defineEventHandler(() => {
        reached.push(`/api/${name}`)
        return 'handler'
      }),
    )
  }
  // The status probe is a GET route and is exempt from the password.
  const router = h3.createRouter()
  router.get(
    mount('/api/access'),
    h3.defineEventHandler(() => JSON.stringify({ required: true })),
  )
  app.use(router)

  const server = http.createServer(h3.toNodeListener(app))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  return {
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    reached,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

describe('access password', () => {
  it('accepts only the exact URI-encoded password', () => {
    assert.equal(isAccessPasswordValid(encodeURIComponent('s3cret'), 's3cret'), true)
    assert.equal(isAccessPasswordValid(encodeURIComponent('s3cret '), 's3cret'), false)
    assert.equal(isAccessPasswordValid(encodeURIComponent('S3cret'), 's3cret'), false)
    assert.equal(isAccessPasswordValid(undefined, 's3cret'), false)
    assert.equal(isAccessPasswordValid('', 's3cret'), false)
  })

  it('supports non-ASCII passwords and rejects malformed encodings', () => {
    assert.equal(isAccessPasswordValid(encodeURIComponent('密码🔑'), '密码🔑'), true)
    assert.equal(isAccessPasswordValid('%E4%BD', '密码🔑'), false)
  })
})

/**
 * Regression for an encoded-path bypass: the middleware used to compare the *raw* URL pathname
 * against `/api/`, so `/%61pi/research` slipped past the check while Nitro routed the decoded path
 * to the real handler. These cases drive the real middleware through h3's request pipeline so both
 * path interpretations are exercised together.
 */
describe('access middleware and encoded paths', () => {
  let h3: H3
  let harness: Harness

  const apiPaths = [...GUARDED_ROUTES]
  const post = (path: string, headers: Record<string, string> = {}) =>
    fetch(`${harness.baseUrl}${path}`, { method: 'POST', headers })

  before(async () => {
    h3 = await loadH3()
    installServerGlobals(h3)
    const middleware = (await import('../server/middleware/access.ts')).default
    harness = await startHarness(h3, middleware)
  })

  after(async () => {
    await harness.close()
  })

  it('rejects plain API paths when the password is missing or wrong', async () => {
    for (const name of apiPaths) {
      const missing = await post(`/api/${name}`)
      assert.equal(missing.status, 401, `/api/${name} without a password`)
      const wrong = await post(`/api/${name}`, { 'x-access-password': 'nope' })
      assert.equal(wrong.status, 401, `/api/${name} with a wrong password`)
    }
  })

  it('rejects percent-encoded API paths that decode to a real route', async () => {
    const encoded = [
      '/%61pi/feedback', // encoded "a"
      '/ap%69/feedback', // encoded "i"
      '/%61pi/research',
      '/%61pi/report',
      '/%61pi/feedback/', // trailing slash still routes
    ]
    for (const path of encoded) {
      const response = await post(path)
      assert.equal(response.status, 401, `${path} must not bypass the password`)
    }
  })

  it('keeps the status probe reachable so visitors can be prompted', async () => {
    assert.equal((await fetch(`${harness.baseUrl}/api/access`)).status, 200)
    assert.equal((await fetch(`${harness.baseUrl}/%61pi/access`)).status, 200)
  })

  it('lets verified callers through to the handler', async () => {
    harness.reached.length = 0
    for (const name of apiPaths) {
      const response = await post(`/api/${name}`, {
        'x-access-password': encodeURIComponent(PASSWORD),
      })
      assert.equal(response.status, 200, `/api/${name} with the password`)
    }
    assert.equal(harness.reached.length, apiPaths.length)
  })
})

/**
 * Nitro mounts server middleware at `app.baseURL`, and h3 strips that prefix before handing the
 * event to the handler. Comparing a URL-derived pathname against `/api/` therefore never matched
 * under a sub-path deployment, silently disabling the password for *every* request. `event.path`
 * is base-relative already, so the guard holds at either mount point.
 */
describe('access middleware under a sub-path deployment', () => {
  let h3: H3
  let harness: Harness

  const probe = (path: string, headers: Record<string, string> = {}) =>
    fetch(`${harness.baseUrl}${path}`, { method: 'POST', headers })

  before(async () => {
    h3 = await loadH3()
    installServerGlobals(h3)
    const middleware = (await import('../server/middleware/access.ts')).default
    harness = await startHarness(h3, middleware, '/app/')
  })

  after(async () => {
    await harness.close()
  })

  it('still requires the password for plain sub-path requests', async () => {
    for (const name of GUARDED_ROUTES) {
      assert.equal((await probe(`/app/api/${name}`)).status, 401, `/app/api/${name}`)
    }
  })

  it('still rejects percent-encoded sub-path requests', async () => {
    for (const path of ['/app/%61pi/feedback', '/app/ap%69/research', '/app/%61pi/report']) {
      assert.equal((await probe(path)).status, 401, path)
    }
  })

  it('keeps the sub-path status probe reachable', async () => {
    assert.equal((await fetch(`${harness.baseUrl}/app/api/access`)).status, 200)
  })

  it('admits verified callers under the sub-path', async () => {
    const response = await probe('/app/api/feedback', {
      'x-access-password': encodeURIComponent(PASSWORD),
    })
    assert.equal(response.status, 200)
    assert.deepEqual(harness.reached, ['/api/feedback'])
  })
})

/**
 * Defense in depth: the money-spending handlers assert access themselves, so a future gap in the
 * path-based middleware cannot hand out the server's credentials.
 */
describe('per-handler access assertion', () => {
  let h3: H3
  let harness: Harness

  before(async () => {
    h3 = await loadH3()
    installServerGlobals(h3)
    const { assertAccessAuthorized } = await import('../server/utils/access.ts')
    const reached: string[] = []
    const app = h3.createApp()
    // No access middleware at all, to prove the handler check stands on its own.
    for (const name of GUARDED_ROUTES) {
      app.use(
        `/api/${name}`,
        h3.defineEventHandler((event) => {
          assertAccessAuthorized(event)
          reached.push(`/api/${name}`)
          return 'handler'
        }),
      )
    }
    const server = http.createServer(h3.toNodeListener(app))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    harness = {
      baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      reached,
      close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    }
  })

  after(async () => {
    await harness.close()
  })

  const post = (path: string, headers: Record<string, string> = {}) =>
    fetch(`${harness.baseUrl}${path}`, { method: 'POST', headers })

  it('blocks unauthenticated calls even with no middleware in front', async () => {
    for (const name of GUARDED_ROUTES) {
      const response = await post(`/api/${name}`)
      assert.equal(response.status, 401, `/api/${name} must be gated by the handler itself`)
    }
    assert.deepEqual(harness.reached, [])
  })

  it('admits callers that carry the password', async () => {
    const response = await post('/api/research', {
      'x-access-password': encodeURIComponent(PASSWORD),
    })
    assert.equal(response.status, 200)
    assert.deepEqual(harness.reached, ['/api/research'])
  })

  it('stays open when no password is configured', async () => {
    globalThis.useRuntimeConfig = (() => ({
      accessPassword: undefined,
      public: { serverMode: true },
    })) as any
    try {
      assert.equal((await post('/api/report')).status, 200)
    } finally {
      installServerGlobals(h3)
    }
  })

  it('refuses every route when server mode is disabled', async () => {
    // NUXT_PUBLIC_SERVER_MODE defaults to false, and such deployments configure no password, so
    // without this check the routes would proxy the server's keys to anyone.
    installServerGlobals(h3, { accessPassword: '', serverMode: false })
    harness.reached.length = 0
    try {
      for (const name of GUARDED_ROUTES) {
        const response = await post(`/api/${name}`)
        assert.equal(response.status, 401, `/api/${name} must be refused without server mode`)
      }
      assert.deepEqual(harness.reached, [])
    } finally {
      installServerGlobals(h3)
    }
  })

  it('rejects cross-site callers that carry a valid password', async () => {
    harness.reached.length = 0
    const response = await post('/api/research', {
      'x-access-password': encodeURIComponent(PASSWORD),
      origin: 'https://evil.example',
    })
    assert.equal(response.status, 403)
    assert.deepEqual(harness.reached, [])
  })

  it('accepts the same password from a same-origin caller', async () => {
    const sameOrigin = new URL(harness.baseUrl).origin
    for (const headers of [{ origin: sameOrigin }, {}, { 'sec-fetch-site': 'same-origin' }]) {
      const response = await post('/api/research', {
        'x-access-password': encodeURIComponent(PASSWORD),
        ...headers,
      })
      assert.equal(response.status, 200, JSON.stringify(headers))
    }
  })

  it('accepts a public Origin forwarded through a rewriting reverse proxy', async () => {
    // The proxy rewrites `Host` to the internal address; the browser still reports the public one.
    const response = await post('/api/research', {
      'x-access-password': encodeURIComponent(PASSWORD),
      origin: 'https://research.example.com',
      'x-forwarded-host': 'research.example.com',
    })
    assert.equal(response.status, 200)
  })

  it('rejects a browser request that declares itself cross-site', async () => {
    const response = await post('/api/research', {
      'x-access-password': encodeURIComponent(PASSWORD),
      'sec-fetch-site': 'cross-site',
    })
    assert.equal(response.status, 403)
  })

  // The cases above use stand-ins and would pass even if a real route forgot the check, so assert
  // the actual handlers carry it. Loading them would drag in the AI SDK and search clients; the
  // source-level check keeps the guarantee cheap and readable.
  it('real routes call the assertion before touching server credentials', () => {
    for (const name of GUARDED_ROUTES) {
      const source = readFileSync(`${process.cwd()}/server/api/${name}.post.ts`, 'utf8')
      const assertAt = source.indexOf('assertAccessAuthorized(event)')
      const configAt = source.indexOf('useRuntimeConfig()')
      assert.ok(assertAt > -1, `server/api/${name}.post.ts must assert access itself`)
      assert.ok(
        configAt === -1 || assertAt < configAt,
        `server/api/${name}.post.ts must assert access before reading runtime config`,
      )
    }
  })
})
