import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveWebSearchApiBase } from '../lib/core/web-search.ts'

describe('resolveWebSearchApiBase', () => {
  it('uses Firecrawl default when apiBase is missing', () => {
    assert.equal(resolveWebSearchApiBase('firecrawl'), 'https://api.firecrawl.dev')
  })

  it('uses fastCRW default when apiBase is missing', () => {
    assert.equal(resolveWebSearchApiBase('crw'), 'https://fastcrw.com/api')
  })

  it('prefers explicit apiBase for Firecrawl-compatible providers', () => {
    assert.equal(resolveWebSearchApiBase('firecrawl', 'https://example.com'), 'https://example.com')
    assert.equal(resolveWebSearchApiBase('crw', 'https://crw.local/api'), 'https://crw.local/api')
  })

  it('returns undefined for providers without a configurable API base', () => {
    assert.equal(resolveWebSearchApiBase('tavily'), undefined)
    assert.equal(resolveWebSearchApiBase('tavily', 'https://ignored.example'), undefined)
    assert.equal(resolveWebSearchApiBase('google-pse'), undefined)
    assert.equal(resolveWebSearchApiBase('google-pse', 'https://www.googleapis.com'), undefined)
  })
})

import { buildSearchFilters, mapFirecrawlResults, searchWeb } from '../lib/core/web-search.ts'
import { searchPlanSchema, resolveSearchPlan } from '../shared/utils/search-plan.ts'

describe('provider search filters', () => {
  it('maps news, time and domains to Tavily and Firecrawl native filters', () => {
    const options = {
      intent: 'news' as const,
      timeRange: 'week' as const,
      includeDomains: ['example.com'],
      lang: 'en',
    }
    const tavily = buildSearchFilters('tavily', options)
    assert.equal(tavily.tavily.topic, 'news')
    assert.equal(tavily.tavily.timeRange, 'week')
    assert.deepEqual(tavily.tavily.includeDomains, ['example.com'])
    assert.equal(tavily.tavily.language, 'en')
    const firecrawl = buildSearchFilters('firecrawl', options)
    assert.deepEqual(firecrawl.firecrawl.sources, ['news'])
    assert.equal(firecrawl.firecrawl.tbs, 'qdr:w')
    assert.deepEqual(firecrawl.limitations, ['language'])
  })
  it('maps calendar dates without leaking dates into keywords', () => {
    const options = { startDate: '2026-09-01', endDate: '2026-09-07' }
    assert.equal(
      buildSearchFilters('firecrawl', options).firecrawl.tbs,
      'cdr:1,cd_min:09/01/2026,cd_max:09/07/2026',
    )
    assert.equal(buildSearchFilters('tavily', options).tavily.start_date, options.startDate)
    assert.deepEqual(buildSearchFilters('google-pse', options).limitations, ['time'])
  })
  it('maps PSE relative dates, one domain, and its Chinese language code', () => {
    const filters = buildSearchFilters('google-pse', {
      intent: 'news',
      timeRange: 'week',
      includeDomains: ['example.com'],
      lang: 'zh',
    })
    assert.deepEqual(filters.google, {
      lr: 'lang_zh-CN',
      dateRestrict: 'w1',
      siteSearch: 'example.com',
      siteSearchFilter: 'i',
    })
    assert.deepEqual(filters.limitations, ['news'])
    assert.deepEqual(
      buildSearchFilters('google-pse', { includeDomains: ['a.com', 'b.com'] }).limitations,
      ['domains'],
    )
  })
  it('does not assume CRW implements Firecrawl-specific search filters', () => {
    const filters = buildSearchFilters('crw', {
      intent: 'news',
      timeRange: 'week',
      includeDomains: ['example.com'],
      lang: 'en',
    })
    assert.deepEqual(filters.firecrawl, {})
    assert.deepEqual(filters.limitations, ['news', 'time', 'domains', 'language'])
  })
  it('retains news snippets and dates even when scraping returns no markdown', () => {
    assert.deepEqual(
      mapFirecrawlResults([
        {
          url: 'https://example.com/news',
          title: 'Launch',
          snippet: 'A new product',
          date: '2 hours ago',
        },
      ]),
      [
        {
          url: 'https://example.com/news',
          title: 'Launch',
          content: 'A new product',
          sourceType: 'search-result',
          publishedAt: '2 hours ago',
        },
      ],
    )
    assert.equal(
      mapFirecrawlResults([
        { markdown: 'Page body', metadata: { sourceURL: 'https://example.com' } },
      ])[0]?.sourceType,
      'page',
    )
    assert.deepEqual(mapFirecrawlResults([{ title: 'No usable text' }]), [])
  })
  it('sends native PSE filters on the actual request', async () => {
    const previous = globalThis.fetch
    globalThis.fetch = async (input) => {
      const url = new URL(String(input))
      assert.equal(url.searchParams.get('q'), 'AI product launches')
      assert.equal(url.searchParams.get('dateRestrict'), 'w1')
      assert.equal(url.searchParams.get('lr'), 'lang_en')
      return Response.json({
        items: [{ link: 'https://example.com', title: 'A launch', snippet: 'News content' }],
      })
    }
    try {
      const notices: string[][] = []
      const results = await searchWeb(
        { provider: 'google-pse', apiKey: 'test-only', googlePseId: 'test-only' },
        'AI product launches',
        {
          intent: 'news',
          timeRange: 'week',
          lang: 'en',
          onNotice: (value) => notices.push(value),
        },
      )
      assert.equal(results.length, 1)
      assert.deepEqual(notices, [['news']])
    } finally {
      globalThis.fetch = previous
    }
  })
})

describe('search plan validation', () => {
  it('copies inherited domain restrictions while allowing domains for unrestricted searches', () => {
    const inherited = { includeDomains: ['example.com'] }
    const plan = { query: 'Acme details', researchGoal: '', includeDomains: ['outside.example'] }
    const resolved = resolveSearchPlan(plan, inherited)
    assert.deepEqual(resolved.includeDomains, ['example.com'])
    resolved.includeDomains!.push('another.example')
    assert.deepEqual(inherited.includeDomains, ['example.com'])
    assert.deepEqual(resolveSearchPlan(plan).includeDomains, plan.includeDomains)
    assert.deepEqual(
      resolveSearchPlan(plan, { includeDomains: [] }).includeDomains,
      plan.includeDomains,
    )
  })

  it('accepts legacy query objects, rejects invalid dates/domains, and never truncates meaningful queries', () => {
    const query =
      'A detailed entity-specific query with a meaningful long product name and comparison'
    assert.equal(searchPlanSchema.parse({ query, researchGoal: '' }).query, query)
    assert.equal(
      searchPlanSchema.safeParse({ query, researchGoal: '', startDate: '2026-02-30' }).success,
      false,
    )
    assert.equal(
      searchPlanSchema.safeParse({
        query,
        researchGoal: '',
        includeDomains: ['https://example.com/path'],
      }).success,
      false,
    )
  })
  it('preserves inherited dates and rejects inverted intervals', () => {
    const plan = { query: 'AI news', researchGoal: '', timeRange: 'year' as const }
    const resolved = resolveSearchPlan(plan, { startDate: '2026-09-01', endDate: '2026-09-07' })
    assert.equal(resolved.timeRange, undefined)
    assert.equal(resolved.startDate, '2026-09-01')
    assert.throws(() =>
      resolveSearchPlan({ ...plan, startDate: '2026-09-07', endDate: '2026-09-01' }),
    )
  })
})

import { createServer } from 'node:http'
import { once } from 'node:events'

it('sends Firecrawl native news filters through the installed SDK and consumes its news response', async () => {
  let request: any
  const server = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    request = JSON.parse(body)
    res.setHeader('Content-Type', 'application/json')
    res.end(
      JSON.stringify({
        success: true,
        data: {
          news: [
            {
              title: 'Launch',
              url: 'https://example.com',
              snippet: 'New editor',
              date: '2026-09-06',
            },
          ],
        },
      }),
    )
  }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    const address = server.address() as { port: number }
    const results = await searchWeb(
      { provider: 'firecrawl', apiKey: 'test-only', apiBase: `http://127.0.0.1:${address.port}` },
      'AI product launches',
      { intent: 'news', timeRange: 'week' },
    )
    assert.equal(request.query, 'AI product launches')
    assert.equal(request.tbs, 'qdr:w')
    assert.deepEqual(request.sources, ['news'])
    assert.deepEqual(request.scrapeOptions.formats, ['markdown'])
    assert.equal(results[0]?.publishedAt, '2026-09-06')
    assert.equal(results[0]?.sourceType, 'search-result')
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
})

import { createReadSource, createWebSearch } from '../lib/core/web-search.ts'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

it('extracts Tavily page text through the installed SDK and handles failed page results', async () => {
  // Intercept only the SDK HTTP transport; exercise its real request/response mapping.
  const require = createRequire(import.meta.url)
  const sdkRequire = createRequire(require.resolve('@tavily/core'))
  const axios = (
    await import(
      pathToFileURL(sdkRequire.resolve('axios/package.json').replace('package.json', 'index.js'))
        .href
    )
  ).default
  const previousAdapter = axios.defaults.adapter
  let fail = false
  axios.defaults.adapter = async (config: any) => {
    const body = JSON.parse(config.data)
    assert.deepEqual(body.urls, ['https://example.com/page'])
    assert.equal(body.extract_depth, 'basic')
    assert.equal(body.timeout, 15)
    return {
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
      data: {
        results: fail
          ? []
          : [{ url: 'https://example.com/final', raw_content: 'Verified page body' }],
        failed_results: fail ? [{ url: 'https://example.com/page', error: 'Blocked' }] : [],
      },
    }
  }
  try {
    const read = createWebSearch({ provider: 'tavily', apiKey: 'test-only' }).readSource!
    const page = await read('https://example.com/page', {})
    assert.equal(page?.content, 'Verified page body')
    assert.equal(page?.url, 'https://example.com/page')
    assert.equal(page?.finalUrl, 'https://example.com/final')
    assert.equal(page?.sourceType, 'page')
    fail = true
    assert.equal(await read('https://example.com/page', {}), undefined)
  } finally {
    axios.defaults.adapter = previousAdapter
  }
  assert.equal(createReadSource({ provider: 'google-pse' }), undefined)
  assert.equal(createReadSource({ provider: 'crw' }), undefined)
})

it('scrapes Firecrawl markdown through the installed SDK using the configured API base', async () => {
  const server = createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw)
    assert.equal(req.url, '/v2/scrape')
    assert.equal(body.url, 'https://example.com/page')
    assert.deepEqual(body.formats, ['markdown'])
    assert.equal(body.onlyMainContent, true)
    assert.equal(body.timeout, 15_000)
    res.setHeader('Content-Type', 'application/json')
    res.end(
      JSON.stringify({
        success: true,
        data: {
          markdown: 'Official body',
          metadata: { title: 'Official page', sourceURL: 'https://example.com/final' },
        },
      }),
    )
  }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    const { port } = server.address() as { port: number }
    const read = createReadSource({
      provider: 'firecrawl',
      apiKey: 'test-only',
      apiBase: `http://127.0.0.1:${port}`,
    })!
    assert.deepEqual(await read('https://example.com/page', {}), {
      url: 'https://example.com/page',
      finalUrl: 'https://example.com/final',
      title: 'Official page',
      content: 'Official body',
      sourceType: 'page',
    })
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

describe('youcom provider', () => {
  it('reports unsupported news/time/domain/language filters as limitations', () => {
    const filters = buildSearchFilters('youcom', {
      intent: 'news',
      timeRange: 'week',
      includeDomains: ['example.com'],
      lang: 'en',
    })
    assert.deepEqual(filters.limitations, ['news', 'time', 'domains', 'language'])
    assert.deepEqual(buildSearchFilters('youcom', {}).limitations, [])
  })

  it('sends the query through the keyless endpoint without auth headers', async () => {
    const previous = globalThis.fetch
    let requestedUrl: URL | undefined
    let requestedHeaders: Record<string, string> = {}
    globalThis.fetch = (async (input: any, init?: any) => {
      requestedUrl = new URL(String(input))
      requestedHeaders = init?.headers ?? {}
      return Response.json({
        results: {
          web: [
            {
              url: 'https://example.com/one',
              title: 'Result one',
              description: 'A curated summary',
              snippets: ['An excerpt from the page'],
              page_age: '2026-09-01T00:00:00',
            },
          ],
          news: [
            {
              url: 'https://example.com/news',
              title: 'Result news',
              description: 'A news summary',
            },
          ],
        },
      })
    }) as typeof fetch
    try {
      const notices: string[][] = []
      const results = await searchWeb({ provider: 'youcom' }, 'AI product launches', {
        maxResults: 7,
        onNotice: (value) => notices.push(value),
      })
      assert.equal(requestedUrl?.hostname, 'api.you.com')
      assert.equal(requestedUrl?.pathname, '/v1/agents/search')
      assert.equal(requestedUrl?.searchParams.get('query'), 'AI product launches')
      assert.equal(requestedUrl?.searchParams.get('count'), '7')
      assert.equal(requestedHeaders['X-API-Key'], undefined)
      assert.equal(results.length, 2)
      assert.equal(results[0]?.content, 'A curated summary\nAn excerpt from the page')
      assert.equal(results[0]?.publishedAt, '2026-09-01T00:00:00')
      assert.equal(results[0]?.sourceType, 'search-result')
      assert.equal(results[1]?.content, 'A news summary')
      // onNotice fires even with no limitations (same as other providers).
      assert.deepEqual(notices, [[]])
    } finally {
      globalThis.fetch = previous
    }
  })

  it('uses the keyed endpoint with X-API-Key when a key is configured', async () => {
    const previous = globalThis.fetch
    let requestedUrl: URL | undefined
    let requestedHeaders: Record<string, string> = {}
    globalThis.fetch = (async (input: any, init?: any) => {
      requestedUrl = new URL(String(input))
      requestedHeaders = init?.headers ?? {}
      return Response.json({ results: { web: [] } })
    }) as typeof fetch
    try {
      await searchWeb({ provider: 'youcom', apiKey: 'test-only' }, 'query')
      assert.equal(requestedUrl?.hostname, 'ydc-index.io')
      assert.equal(requestedUrl?.pathname, '/v1/search')
      assert.equal(requestedHeaders['X-API-Key'], 'test-only')
    } finally {
      globalThis.fetch = previous
    }
  })

  it('drops items without url or content and surfaces HTTP errors', async () => {
    const previous = globalThis.fetch
    globalThis.fetch = (async () =>
      Response.json(
        {
          results: {
            web: [
              { title: 'No url', description: 'orphan' },
              { url: 'https://example.com/empty', title: 'No text' },
            ],
          },
        },
        { status: 200 },
      )) as typeof fetch
    try {
      assert.deepEqual(await searchWeb({ provider: 'youcom' }, 'query'), [])
    } finally {
      globalThis.fetch = previous
    }

    globalThis.fetch = (async () =>
      new Response('Payment Required', { status: 402 })) as typeof fetch
    try {
      await assert.rejects(
        () => searchWeb({ provider: 'youcom' }, 'query'),
        /You.com search failed \(keyless\): HTTP 402/,
      )
    } finally {
      globalThis.fetch = previous
    }
  })
})

it('reports the news limitation when You.com returns only web results', async () => {
  const previous = globalThis.fetch
  globalThis.fetch = async () =>
    Response.json({
      results: {
        web: [{ url: 'https://example.com/docs', description: 'Product documentation' }],
        news: [],
      },
    })
  try {
    const notices: string[][] = []
    const results = await searchWeb({ provider: 'youcom' }, 'Nuxt', {
      intent: 'news',
      onNotice: (value) => notices.push(value),
    })
    assert.equal(results.length, 1)
    assert.deepEqual(notices, [['news']])
  } finally {
    globalThis.fetch = previous
  }
})

describe('serply provider', () => {
  it('maps time, language and news to Google URL parameters and flags explicit dates', () => {
    const filters = buildSearchFilters('serply', {
      intent: 'news',
      timeRange: 'week',
      includeDomains: ['example.com'],
      lang: 'zh',
    })
    assert.deepEqual(filters.serply, { tbs: 'qdr:w', lr: 'lang_zh-CN', tbm: 'nws' })
    assert.deepEqual(filters.limitations, [])
    const dated = buildSearchFilters('serply', { startDate: '2024-01-01', endDate: '2024-02-01' })
    assert.deepEqual(dated.serply, {})
    assert.deepEqual(dated.limitations, ['time'])
  })

  it('sends the key header, a site clause for domains, and clamps num to the API cap', async () => {
    const previous = globalThis.fetch
    let requestedUrl: URL | undefined
    let requestedHeaders: Record<string, string> = {}
    globalThis.fetch = (async (input: any, init?: any) => {
      requestedUrl = new URL(String(input))
      requestedHeaders = init?.headers ?? {}
      return Response.json({
        results: Array.from({ length: 12 }, (_, index) => ({
          title: `Result ${index}`,
          link: `https://example.com/${index}`,
          description: `Snippet ${index}`,
          metadata: index === 0 ? { published_time: '2 days ago' } : {},
        })),
      })
    }) as typeof fetch
    try {
      const results = await searchWeb({ provider: 'serply', apiKey: 'test-only' }, 'nuxt', {
        includeDomains: ['nuxt.com', 'github.com'],
        maxResults: 11,
      })
      assert.equal(requestedUrl?.hostname, 'api.serply.io')
      assert.equal(requestedUrl?.pathname, '/v1/search')
      assert.equal(requestedUrl?.searchParams.get('q'), 'nuxt (site:nuxt.com OR site:github.com)')
      assert.equal(requestedUrl?.searchParams.get('num'), '10')
      assert.equal(requestedHeaders['X-Api-Key'], 'test-only')
      assert.equal(requestedHeaders['User-Agent'], 'deep-research-web-ui')
      assert.equal(results.length, 11)
      assert.deepEqual(results[0], {
        content: 'Snippet 0',
        sourceType: 'search-result',
        url: 'https://example.com/0',
        title: 'Result 0',
        publishedAt: '2 days ago',
      })
      assert.equal('publishedAt' in results[1]!, false)
    } finally {
      globalThis.fetch = previous
    }
  })

  it('requires a key, drops items without link or description, and surfaces API errors', async () => {
    await assert.rejects(() => searchWeb({ provider: 'serply' }, 'query'), /Serply API key not set/)

    const previous = globalThis.fetch
    globalThis.fetch = (async () =>
      Response.json({
        results: [
          { title: 'No link', description: 'orphan' },
          { link: 'https://example.com/empty', title: 'No text' },
        ],
      })) as typeof fetch
    try {
      assert.deepEqual(await searchWeb({ provider: 'serply', apiKey: 'k' }, 'query'), [])
    } finally {
      globalThis.fetch = previous
    }

    globalThis.fetch = (async () =>
      Response.json({ detail: 'Invalid API key' }, { status: 401 })) as typeof fetch
    try {
      await assert.rejects(
        () => searchWeb({ provider: 'serply', apiKey: 'k' }, 'query'),
        /Serply Error: Invalid API key/,
      )
    } finally {
      globalThis.fetch = previous
    }

    globalThis.fetch = (async () => new Response('Bad gateway', { status: 502 })) as typeof fetch
    try {
      await assert.rejects(
        () => searchWeb({ provider: 'serply', apiKey: 'k' }, 'query'),
        /Serply Error: HTTP 502/,
      )
    } finally {
      globalThis.fetch = previous
    }
  })
})

describe('keenable provider', () => {
  it('maps time, dates and a single domain natively and reports the rest', () => {
    const filters = buildSearchFilters('keenable', {
      intent: 'news',
      timeRange: 'week',
      includeDomains: ['example.com'],
      lang: 'en',
    })
    assert.deepEqual(filters.keenable, { published_after: '7d', site: 'example.com' })
    assert.deepEqual(filters.limitations, ['news', 'language'])

    const dated = buildSearchFilters('keenable', {
      startDate: '2024-01-01',
      endDate: '2024-02-29',
      includeDomains: ['a.example', 'b.example'],
    })
    // endDate stays inclusive: published_before is the following day.
    assert.deepEqual(dated.keenable, {
      published_after: '2024-01-01',
      published_before: '2024-03-01',
    })
    assert.deepEqual(dated.limitations, ['domains'])
    assert.deepEqual(buildSearchFilters('keenable', {}).limitations, [])
  })

  it('uses the keyless public endpoint with an app title and no API key', async () => {
    const previous = globalThis.fetch
    let requestedUrl: URL | undefined
    let requestInit: any
    globalThis.fetch = (async (input: any, init?: any) => {
      requestedUrl = new URL(String(input))
      requestInit = init
      // Shape returned live by POST /v1/search/public (checked 2026-11-15).
      return Response.json({
        query: 'AI product launches',
        mode: 'pro',
        results: [
          {
            title: 'Result one',
            url: 'https://example.com/one',
            description: '',
            snippet: 'An excerpt from the page',
            published_at: '2026-09-01T00:00:00Z',
            acquired_at: '2026-09-02T00:00:00Z',
          },
          { title: 'No url', url: '', snippet: 'orphan' },
          { title: 'No text', url: 'https://example.com/empty', snippet: '' },
          { url: 'https://example.com/two', description: 'Only a description' },
        ],
      })
    }) as typeof fetch
    try {
      const notices: string[][] = []
      const results = await searchWeb({ provider: 'keenable' }, 'AI product launches', {
        maxResults: 7,
        timeRange: 'month',
        onNotice: (value) => notices.push(value),
      })
      assert.equal(requestedUrl?.href, 'https://api.keenable.ai/v1/search/public')
      assert.equal(requestInit.method, 'POST')
      assert.equal(requestInit.headers['X-Keenable-Title'], 'deep-research-web-ui')
      assert.equal(requestInit.headers['X-API-Key'], undefined)
      assert.deepEqual(JSON.parse(requestInit.body), {
        query: 'AI product launches',
        max_results: 7,
        published_after: '1mo',
      })
      assert.deepEqual(results, [
        {
          content: 'An excerpt from the page',
          sourceType: 'search-result',
          url: 'https://example.com/one',
          title: 'Result one',
          publishedAt: '2026-09-01T00:00:00Z',
        },
        {
          content: 'Only a description',
          sourceType: 'search-result',
          url: 'https://example.com/two',
        },
      ])
      assert.deepEqual(notices, [[]])
    } finally {
      globalThis.fetch = previous
    }
  })

  it('uses the keyed endpoint with X-API-Key and surfaces HTTP errors with status', async () => {
    const previous = globalThis.fetch
    let requestedUrl: URL | undefined
    let requestHeaders: Record<string, string> = {}
    globalThis.fetch = (async (input: any, init?: any) => {
      requestedUrl = new URL(String(input))
      requestHeaders = init?.headers ?? {}
      return Response.json(
        { error: 'Authentication failed', message: 'Malformed API key' },
        { status: 401 },
      )
    }) as typeof fetch
    try {
      const error = await searchWeb({ provider: 'keenable', apiKey: 'test-only' }, 'query').then(
        () => assert.fail('expected an error'),
        (value: any) => value,
      )
      assert.equal(requestedUrl?.href, 'https://api.keenable.ai/v1/search')
      assert.equal(requestHeaders['X-API-Key'], 'test-only')
      assert.equal(requestHeaders['X-Keenable-Title'], undefined)
      assert.match(error.message, /Keenable search failed \(keyed\): HTTP 401: Malformed API key/)
      assert.equal(error.cause.status, 401)
    } finally {
      globalThis.fetch = previous
    }
  })

  it('reads a source page as markdown through the fetch endpoint', async () => {
    const previous = globalThis.fetch
    const requests: { url: URL; headers: Record<string, string> }[] = []
    globalThis.fetch = (async (input: any, init?: any) => {
      requests.push({ url: new URL(String(input)), headers: init?.headers ?? {} })
      return Response.json({
        url: 'https://example.com/final',
        title: 'Page',
        content: '# Page\n\nBody',
        truncated: false,
      })
    }) as typeof fetch
    try {
      const keyless = createReadSource({ provider: 'keenable' })!
      const page = await keyless('https://example.com/a', {})
      assert.equal(
        requests[0]?.url.origin + requests[0]!.url.pathname,
        'https://api.keenable.ai/v1/fetch/public',
      )
      assert.equal(requests[0]?.url.searchParams.get('url'), 'https://example.com/a')
      assert.equal(requests[0]?.headers['X-Keenable-Title'], 'deep-research-web-ui')
      assert.deepEqual(page, {
        url: 'https://example.com/a',
        finalUrl: 'https://example.com/final',
        title: 'Page',
        content: '# Page\n\nBody',
        sourceType: 'page',
      })

      await createReadSource({ provider: 'keenable', apiKey: 'k' })!('https://example.com/b', {})
      assert.equal(requests[1]?.url.pathname, '/v1/fetch')
      assert.equal(requests[1]?.headers['X-API-Key'], 'k')
    } finally {
      globalThis.fetch = previous
    }

    globalThis.fetch = (async () => Response.json({ content: '  ' })) as typeof fetch
    try {
      assert.equal(
        await createReadSource({ provider: 'keenable' })!('https://example.com', {}),
        undefined,
      )
    } finally {
      globalThis.fetch = previous
    }
  })
})
