import assert from 'node:assert/strict'
import { it } from 'node:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { Readable } from 'node:stream'
import axios from 'axios'
import { createProxyFetch, resolveProxyConfig } from '../server/utils/proxy.ts'
import type { RuntimeConfig } from 'nuxt/schema'
import { createParallelWebSearch } from '../server/utils/parallel-search.ts'
import project from '../public/version.json' with { type: 'json' }
import { searchWeb } from '../lib/core/web-search.ts'

const globals = globalThis as any
const previousHandler = globals.defineEventHandler
globals.defineEventHandler = (handler: unknown) => handler
const { createServerWebSearch } = await import('../server/api/research.post.ts')
if (previousHandler === undefined) delete globals.defineEventHandler
else globals.defineEventHandler = previousHandler

type RpcRequest = { id?: number; method: string; params?: any }
function fixture(toolResponse: (request: RpcRequest) => unknown) {
  const requests: { rpc: RpcRequest; headers: Headers; signal?: AbortSignal | null }[] = []
  const fetch: typeof globalThis.fetch = async (input, init) => {
    assert.equal(String(input), 'https://search.parallel.ai/mcp')
    assert.equal(init?.redirect, 'error')
    if (init?.method === 'GET') return new Response('', { status: 405 })
    if (init?.method === 'DELETE') return new Response(null, { status: 204 })
    const rpc = JSON.parse(String(init?.body)) as RpcRequest
    const headers = new Headers(init?.headers)
    assert.equal(headers.has('Authorization'), false)
    assert.equal(headers.has('X-API-Key'), false)
    requests.push({ rpc, headers, signal: init?.signal })
    if (rpc.method === 'notifications/initialized') return new Response(null, { status: 202 })
    const result =
      rpc.method === 'initialize'
        ? {
            protocolVersion: '2025-03-26',
            capabilities: { tools: {} },
            serverInfo: { name: 'fixture', version: '1' },
          }
        : rpc.method === 'tools/list'
          ? {
              tools: ['web_search', 'web_fetch'].map((name) => ({
                name,
                inputSchema: { type: 'object' },
              })),
            }
          : toolResponse(rpc)
    if (result instanceof Response) return result
    return Response.json({ jsonrpc: '2.0', id: rpc.id, result })
  }
  return { fetch, requests }
}
const source = {
  url: 'https://example.com/article',
  title: 'Article',
  publish_date: '2026-09-15',
  excerpts: ['First excerpt', 'Second excerpt'],
}
const toolResult = (data: unknown) => ({
  content: [{ type: 'text', text: JSON.stringify(data) }],
  structuredContent: data,
})

it('loads the anonymous server provider, maps useful results, and reuses research metadata across searches and reading', async () => {
  const mock = fixture((request) =>
    toolResult({
      results: [
        {
          ...source,
          ...(request.params.name === 'web_fetch' ? { full_content: 'Full page text' } : {}),
        },
      ],
      errors: [],
    }),
  )
  const previous = globalThis.fetch
  globalThis.fetch = mock.fetch
  try {
    const runtimeConfig = {
      public: { webSearchProvider: 'parallel' },
      webSearchApiKey: 'unused-other-provider-key',
    } as RuntimeConfig
    const search = createServerWebSearch(runtimeConfig)
    assert.equal(search.provider, 'parallel')
    assert.deepEqual(
      await search('official source', {
        maxResults: 1,
        researchGoal: 'Find official evidence for the research question',
      }),
      [
        {
          url: source.url,
          title: 'Article',
          publishedAt: '2026-09-15',
          content: 'First excerpt\nSecond excerpt',
          sourceType: 'search-result',
        },
      ],
    )
    await search('follow-up query', {})
    assert.deepEqual(await search.readSource!(source.url, {}), {
      url: source.url,
      finalUrl: source.url,
      title: 'Article',
      publishedAt: '2026-09-15',
      content: 'Full page text',
      sourceType: 'page',
    })
    await createServerWebSearch(runtimeConfig)('independent research', {})
    const calls = mock.requests.filter(({ rpc }) => rpc.method === 'tools/call')
    assert.equal(calls.length, 4)
    assert.deepEqual(calls[0]!.rpc.params.arguments.search_queries, ['official source'])
    assert.equal(
      calls[0]!.rpc.params.arguments.objective,
      'Find official evidence for the research question',
    )
    assert.deepEqual(calls[2]!.rpc.params.arguments.search_queries, [
      'official source',
      'follow-up query',
    ])
    assert.equal(calls[2]!.rpc.params.arguments.full_content, true)
    assert.deepEqual(calls[2]!.rpc.params.arguments.urls, [source.url])
    assert.ok(
      calls.every(
        ({ headers }) => headers.get('User-Agent') === `deep-research-web-ui/${project.version}`,
      ),
    )
    const ids = calls.map(({ rpc }) => rpc.params.arguments.session_id)
    assert.match(ids[0], /^[0-9a-f-]{36}$/)
    assert.equal(ids[0], ids[1])
    assert.equal(ids[0], ids[2])
    assert.notEqual(ids[0], ids[3])
    assert.equal(mock.requests.filter(({ rpc }) => rpc.method === 'tools/list').length, 0)
    assert.equal(mock.requests.filter(({ rpc }) => rpc.method === 'initialize').length, 2)
  } finally {
    globalThis.fetch = previous
  }
})

it('reports unsupported filters and caps results locally without sending fictional MCP arguments', async () => {
  const mock = fixture(() =>
    toolResult({ results: [source, { ...source, url: 'https://example.org' }] }),
  )
  let notices: unknown
  const results = await createParallelWebSearch({ fetch: mock.fetch })('news', {
    intent: 'news',
    timeRange: 'week',
    includeDomains: ['example.com'],
    lang: 'en',
    maxResults: 1,
    onNotice: (value) => {
      notices = value
    },
  })
  assert.deepEqual(notices, ['news', 'time', 'domains', 'language'])
  assert.equal(results.length, 1)
  const args = mock.requests.find(({ rpc }) => rpc.method === 'tools/call')!.rpc.params.arguments
  assert.deepEqual(Object.keys(args).sort(), ['objective', 'search_queries', 'session_id'])
})

it('supports text-only success and distinguishes empty success from malformed payloads and every service error layer', async () => {
  const cases: [unknown, RegExp | undefined][] = [
    [{ content: [{ type: 'text', text: JSON.stringify({ results: [] }) }] }, undefined],
    [toolResult({ unexpected: [] }), /results/],
    [{ content: [{ type: 'text', text: 'broken JSON' }] }, /JSON/],
    [{ content: [], isError: true }, /tool error/],
    [new Response('Unavailable', { status: 503 }), /503/],
    [
      Response.json({ jsonrpc: '2.0', id: 2, error: { code: -32000, message: 'quota reached' } }),
      /quota reached/,
    ],
  ]
  for (const [result, error] of cases) {
    const mock = fixture((request) => {
      if (result instanceof Response && result.headers.get('content-type')?.includes('json'))
        return Response.json({
          jsonrpc: '2.0',
          id: request.id,
          error: { code: -32000, message: 'quota reached' },
        })
      return result
    })
    const run = () => createParallelWebSearch({ fetch: mock.fetch })('query', {})
    if (error) await assert.rejects(run, error)
    else assert.deepEqual(await run(), [])
  }
})

it('preserves a successful fetched page with partial failures and surfaces a failed page', async () => {
  let success = true
  const mock = fixture(() =>
    toolResult({
      results: success ? [{ ...source, full_content: 'Readable source' }] : [],
      errors: [{ url: 'https://example.com/unreadable', error_type: 'not_found' }],
    }),
  )
  const read = createParallelWebSearch({ fetch: mock.fetch }).readSource!
  assert.equal((await read(source.url, {}))?.content, 'Readable source')
  success = false
  await assert.rejects(() => read(source.url, {}), /could not read/)
})

it('retains valid results when the service returns object-shaped warnings', async () => {
  const previous = console.warn
  const warnings: unknown[][] = []
  console.warn = (...items) => {
    warnings.push(items)
  }
  try {
    const mock = fixture(() =>
      toolResult({
        results: [source],
        warnings: [{ type: 'warning', message: 'Query adjusted', detail: null }],
      }),
    )
    assert.equal(
      (await createParallelWebSearch({ fetch: mock.fetch })('query', {}))[0]?.url,
      source.url,
    )
    assert.deepEqual(warnings, [['[Parallel Search MCP]', 'Query adjusted']])
  } finally {
    console.warn = previous
  }
})

it('fails promptly on an uncorrelated edge error instead of treating it as empty search evidence', async () => {
  const mock = fixture(() =>
    Response.json({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32000, message: 'edge quota failure' },
    }),
  )
  await assert.rejects(() => createParallelWebSearch({ fetch: mock.fetch })('query', {}))
})

it('keeps successful evidence when negotiated session cleanup fails', async () => {
  const mock = fixture(() => toolResult({ results: [source] }))
  let deletes = 0
  const fetch: typeof globalThis.fetch = async (input, init) => {
    if (init?.method === 'DELETE') {
      deletes++
      return new Response('cleanup failed', { status: 500 })
    }
    const response = await mock.fetch(input, init)
    if (init?.body && JSON.parse(String(init.body)).method === 'initialize')
      response.headers.set('Mcp-Session-Id', 'transport-session')
    return response
  }
  const search = createParallelWebSearch({ fetch })
  assert.equal((await search('query', {}))[0]?.url, source.url)
  assert.equal(deletes, 0)
  await search.close!()
  assert.equal(deletes, 1)
  await assert.rejects(() => search('query', {}), /closed/)
})

it('enforces a response byte bound before the SDK buffers the tool envelope', async () => {
  const mock = fixture(
    () =>
      new Response('x'.repeat(2 * 1024 * 1024 + 1), {
        headers: { 'Content-Type': 'application/json' },
      }),
  )
  await assert.rejects(
    () => createParallelWebSearch({ fetch: mock.fetch })('query', {}),
    /exceeded 2 MiB/,
  )
})

it('cancels the outbound request and sends nothing for an already canceled operation', async () => {
  const controller = new AbortController()
  const mock = fixture(() => {
    throw new Error('should not reach tool')
  })
  let entered = false
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const rpc = init?.body ? JSON.parse(String(init.body)) : undefined
    if (rpc?.method !== 'tools/call') return mock.fetch(input, init)
    entered = true
    controller.abort(new DOMException('Canceled', 'AbortError'))
    assert.ok(init?.signal?.aborted)
    throw init?.signal?.reason
  }
  const search = createParallelWebSearch({ fetch })
  await assert.rejects(() => search('query', { signal: controller.signal }), /Canceled/)
  assert.equal(entered, true)
  const count = mock.requests.length
  await assert.rejects(() => search('query', { signal: controller.signal }), /Canceled/)
  assert.equal(mock.requests.length, count)
})

it('rejects Parallel in Client Mode instead of routing it to Tavily', async () => {
  await assert.rejects(() => searchWeb({ provider: 'parallel' }, 'query'), /requires Server Mode/)
})

it('routes the server provider through the configured proxy with attribution and redirect protection', async () => {
  const previous = axios.request
  const mock = fixture(() => toolResult({ results: [source] }))
  const requests: any[] = []
  axios.request = (async (config: any) => {
    requests.push(config)
    const response = await mock.fetch(config.url, {
      method: config.method,
      body: config.data,
      headers: config.headers,
      redirect: 'error',
    })
    return {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers),
      data: Readable.from([Buffer.from(await response.text())]),
    }
  }) as typeof axios.request
  try {
    const runtime = {
      public: { webSearchProvider: 'parallel' },
      proxyUrl: 'http://proxy.example:8080',
    } as RuntimeConfig
    assert.equal((await createServerWebSearch(runtime)('query', {}))[0]?.url, source.url)
    const tool = requests.find(
      (request) => request.data && JSON.parse(request.data).method === 'tools/call',
    )
    assert.equal(tool.proxy.host, 'proxy.example')
    assert.equal(tool.proxy.port, 8080)
    assert.equal(
      new Headers(tool.headers).get('User-Agent'),
      `deep-research-web-ui/${project.version}`,
    )
    assert.equal(tool.maxRedirects, 0)
    assert.equal(tool.responseType, 'stream')
  } finally {
    axios.request = previous
  }
})

it('prevents a proxied request from forwarding its body through a redirect to another local server', async () => {
  let destinationRequests = 0
  const destination = createServer((_request, response) => {
    destinationRequests++
    response.end('unexpected destination')
  })
  destination.listen(0, '127.0.0.1')
  await once(destination, 'listening')
  const destinationPort = (destination.address() as { port: number }).port
  let proxyRequests = 0
  const proxy = createServer((_request, response) => {
    proxyRequests++
    response.writeHead(307, { Location: `http://127.0.0.1:${destinationPort}/` }).end()
  })
  proxy.listen(0, '127.0.0.1')
  await once(proxy, 'listening')
  const port = (proxy.address() as { port: number }).port
  try {
    const proxyFetch = createProxyFetch(
      resolveProxyConfig({ proxyUrl: `http://127.0.0.1:${port}` })!,
    )
    await assert.rejects(
      () =>
        proxyFetch('http://source.example/mcp', {
          method: 'POST',
          body: 'do not forward',
          redirect: 'error',
          signal: AbortSignal.timeout(2_000),
        }),
      /Redirects are disabled/,
    )
    assert.equal(proxyRequests, 1)
    assert.equal(destinationRequests, 0)
  } finally {
    proxy.closeAllConnections()
    destination.closeAllConnections()
    await Promise.all([
      new Promise<void>((resolve) => proxy.close(() => resolve())),
      new Promise<void>((resolve) => destination.close(() => resolve())),
    ])
  }
})

it('shares initialization across concurrent calls and retains per-source queries', async () => {
  const mock = fixture((request) =>
    toolResult({
      results: [
        {
          ...source,
          url:
            request.params.name === 'web_search'
              ? `https://example.com/${request.params.arguments.search_queries[0]}`
              : source.url,
          full_content: 'Evidence',
        },
      ],
    }),
  )
  const search = createParallelWebSearch({ fetch: mock.fetch })
  await Promise.all([search('alpha', {}), search('beta', {})])
  await search.readSource!('https://example.com/alpha', {})
  const calls = mock.requests.filter(({ rpc }) => rpc.method === 'tools/call')
  assert.deepEqual(calls[2]!.rpc.params.arguments.search_queries, ['alpha'])
  assert.equal(mock.requests.filter(({ rpc }) => rpc.method === 'initialize').length, 1)
  await search.close!()
})

it('reconnects after a failed session while keeping the operation ID', async () => {
  let fail = true
  const mock = fixture(() =>
    fail ? new Response('Expired session', { status: 404 }) : toolResult({ results: [source] }),
  )
  const search = createParallelWebSearch({ fetch: mock.fetch })
  await assert.rejects(() => search('first', {}), /404/)
  fail = false
  assert.equal((await search('second', {}))[0]?.url, source.url)
  const calls = mock.requests.filter(({ rpc }) => rpc.method === 'tools/call')
  assert.equal(calls[0]!.rpc.params.arguments.session_id, calls[1]!.rpc.params.arguments.session_id)
  assert.equal(mock.requests.filter(({ rpc }) => rpc.method === 'initialize').length, 2)
  await search.close!()
})

it('cancels one in-flight request without canceling its concurrent sibling', async () => {
  const controller = new AbortController()
  let started!: () => void
  const entered = new Promise<void>((resolve) => {
    started = resolve
  })
  const mock = fixture(() => toolResult({ results: [source] }))
  const search = createParallelWebSearch({
    fetch: async (input, init) => {
      const rpc = init?.body ? JSON.parse(String(init.body)) : undefined
      if (rpc?.method === 'tools/call' && rpc.params.arguments.search_queries[0] === 'cancel') {
        started()
        return await new Promise<Response>((_resolve, reject) => {
          init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), {
            once: true,
          })
        })
      }
      return mock.fetch(input, init)
    },
  })
  const canceled = search('cancel', { signal: controller.signal })
  const rejection = assert.rejects(canceled, /Canceled/)
  await entered
  const sibling = search('keep', {})
  controller.abort(new DOMException('Canceled', 'AbortError'))
  await rejection
  assert.equal((await sibling)[0]?.url, source.url)
  assert.equal((await search('after cancellation', {}))[0]?.url, source.url)
  assert.equal(mock.requests.filter(({ rpc }) => rpc.method === 'initialize').length, 1)
  await search.close!()
})

it('fails only the affected call when a concurrent tool call returns an error', async () => {
  let release!: () => void
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  let siblingStarted!: () => void
  const siblingEntered = new Promise<void>((resolve) => {
    siblingStarted = resolve
  })
  const mock = fixture((request) =>
    request.params.arguments.search_queries[0] === 'bad'
      ? { content: [], isError: true }
      : toolResult({ results: [source] }),
  )
  const search = createParallelWebSearch({
    fetch: async (input, init) => {
      const rpc = init?.body ? JSON.parse(String(init.body)) : undefined
      if (rpc?.method === 'tools/call' && rpc.params.arguments.search_queries[0] === 'keep') {
        siblingStarted()
        await released
      }
      return mock.fetch(input, init)
    },
  })
  const sibling = search('keep', {})
  await siblingEntered
  await assert.rejects(() => search('bad', {}), /tool error/)
  release()
  assert.equal((await sibling)[0]?.url, source.url)
  assert.equal(mock.requests.filter(({ rpc }) => rpc.method === 'initialize').length, 1)
  await search.close!()
})

it('closes an operation during initialization without issuing a tool request', async () => {
  let started!: () => void
  const entered = new Promise<void>((resolve) => {
    started = resolve
  })
  const search = createParallelWebSearch({
    fetch: async (_input, init) => {
      started()
      return await new Promise<Response>((_resolve, reject) => {
        init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true })
      })
    },
  })
  const pending = assert.rejects(() => search('query', {}), /closed/)
  await entered
  await search.close!()
  await pending
  await search.close!()
})

it('carries the native research planner through keyless search to a final cited learning', async () => {
  const { MockLanguageModelV1, convertArrayToReadableStream } = await import('ai/test')
  const { deepResearch } = await import('../lib/core/deep-research.ts')
  const previousModel = globals.getLanguageModel
  const previousFetch = globalThis.fetch
  const goal = 'Find the official project release evidence'
  const finding = {
    url: source.url,
    learning: 'The project released version one.',
    quote: 'The project released version one.',
  }
  const outputs = [
    { queries: [{ query: 'official project release', researchGoal: goal }] },
    { learnings: [finding], relevantUrls: [source.url], followUpQuestions: [] },
  ]
  const mock = fixture(() => toolResult({ results: [{ ...source, excerpts: [finding.quote] }] }))
  globalThis.fetch = mock.fetch
  globals.getLanguageModel = () =>
    new MockLanguageModelV1({
      doStream: async () => ({
        rawCall: { rawPrompt: '', rawSettings: {} },
        stream: convertArrayToReadableStream([
          { type: 'text-delta', textDelta: JSON.stringify(outputs.shift()) },
          { type: 'finish', finishReason: 'stop', usage: { promptTokens: 1, completionTokens: 1 } },
        ]),
      }),
    })
  const search = createServerWebSearch({
    public: { webSearchProvider: 'parallel' },
  } as RuntimeConfig)
  const steps: any[] = []
  try {
    const result = await deepResearch({
      query: goal,
      breadth: 1,
      maxDepth: 1,
      currentDepth: 1,
      languageCode: 'en',
      aiConfig: { provider: 'openai-compatible', model: 'mock' },
      onProgress: (step) => steps.push(step),
      webSearchFunction: search,
    })
    assert.equal(outputs.length, 0)
    assert.equal(result.learnings[0]?.learning, finding.learning)
    assert.equal(result.learnings[0]?.url, source.url)
    assert.equal(steps.at(-1)?.type, 'complete')
    const args = mock.requests.find(({ rpc }) => rpc.method === 'tools/call')!.rpc.params.arguments
    assert.equal(args.objective, goal)
    assert.deepEqual(args.search_queries, ['official project release'])
  } finally {
    await search.close!()
    globals.getLanguageModel = previousModel
    globalThis.fetch = previousFetch
  }
})
