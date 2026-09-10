import { type ReadSourceFunction } from '~~/lib/core/read-source'
import { tavily } from '@tavily/core'
import Firecrawl, {
  type Document,
  type SearchResultWeb,
  type SearchResultNews,
} from '@mendable/firecrawl-js'
import {
  searchConstraintsSchema,
  resolveSearchPlan,
  type SearchConstraints,
  type SearchLimitation,
} from '~~/shared/utils/search-plan'
import { abortable, isAbortError } from '~~/shared/utils/abort'
import type { ConfigWebSearchProvider } from '~~/shared/types/config'
import type { WebSearchResult } from '~~/shared/types/types'

export type WebSearchOptions = SearchConstraints & {
  maxResults?: number
  /** Search language. Unsupported provider filters are reported through onNotice. */
  lang?: string
  signal?: AbortSignal
  onNotice?: (limitations: SearchLimitation[]) => void
}

export type WebSearchFunction = ((
  query: string,
  options: WebSearchOptions,
) => Promise<WebSearchResult[]>) & {
  provider?: ConfigWebSearchProvider
  readSource?: ReadSourceFunction
}

export type WebSearchConfig = {
  provider: ConfigWebSearchProvider
  apiKey?: string
  apiBase?: string
  googlePseId?: string
  tavilyAdvancedSearch?: boolean
  tavilySearchTopic?: 'general' | 'news' | 'finance'
}

const FIRECRAWL_DEFAULT_API_BASE = 'https://api.firecrawl.dev'
const CRW_DEFAULT_API_BASE = 'https://fastcrw.com/api'
const YOUCOM_KEYLESS_SEARCH_URL = 'https://api.you.com/v1/agents/search'
const YOUCOM_KEYED_SEARCH_URL = 'https://ydc-index.io/v1/search'

/** Single item from the You.com search API `results.web` / `results.news` arrays. */
interface YoucomSearchResult {
  url?: string
  title?: string
  /** Curated summary of the page. */
  description?: string
  /** Excerpts from the page itself. */
  snippets?: string[]
  /** Publication date, e.g. `2025-07-14T00:00:00`. */
  page_age?: string
}

export function resolveWebSearchApiBase(
  provider: ConfigWebSearchProvider,
  apiBase?: string,
): string | undefined {
  if (provider === 'firecrawl') {
    return apiBase || FIRECRAWL_DEFAULT_API_BASE
  }
  if (provider === 'crw') {
    return apiBase || CRW_DEFAULT_API_BASE
  }
  // tavily / google-pse / youcom do not use a configurable API base in this project
  return undefined
}

export function mapFirecrawlResults(
  items: Array<Document | SearchResultWeb | SearchResultNews> | undefined,
): WebSearchResult[] {
  return (items ?? []).flatMap((item) => {
    const r = item as Document & SearchResultWeb & SearchResultNews
    const url = r.url ?? r.metadata?.sourceURL
    const content = r.markdown || r.snippet || r.description
    if (!url || !content) return []
    return [
      {
        content,
        url,
        title: r.title ?? r.metadata?.title,
        sourceType: r.markdown ? ('page' as const) : ('search-result' as const),
        publishedAt: r.date,
      },
    ]
  })
}

/** Build only filters supported by the selected provider; never silently pretend parity. */
export function buildSearchFilters(provider: ConfigWebSearchProvider, options: WebSearchOptions) {
  const limits: SearchLimitation[] = []
  const time = options.timeRange
  const hasDates = !!(options.startDate || options.endDate)
  const domains = options.includeDomains?.length ? options.includeDomains : undefined
  const date = (value: string) => {
    const [year, month, day] = value.split('-')
    return `${month}/${day}/${year}`
  }
  const tbs = hasDates
    ? `cdr:1${options.startDate ? `,cd_min:${date(options.startDate)}` : ''}${options.endDate ? `,cd_max:${date(options.endDate)}` : ''}`
    : time
      ? `qdr:${{ day: 'd', week: 'w', month: 'm', year: 'y' }[time]}`
      : undefined
  const google: Record<string, string> = {}
  if (options.lang) google.lr = `lang_${options.lang === 'zh' ? 'zh-CN' : options.lang}`
  if (time && !hasDates)
    google.dateRestrict = { day: 'd1', week: 'w1', month: 'm1', year: 'y1' }[time]
  if (hasDates) limits.push('time') // PSE has no equivalent publication-date interval filter.
  if (domains?.length === 1) {
    google.siteSearch = domains[0]!
    google.siteSearchFilter = 'i'
  } else if (domains) limits.push('domains')
  if (options.intent === 'news') limits.push('news')
  if (provider === 'google-pse') return { google, firecrawl: {}, tavily: {}, limitations: limits }
  if (provider === 'youcom')
    return {
      // The You.com search endpoints have no native time/domain/language
      // params; the response always includes a `news` section for
      // news-intent queries, so only the other constraints are reported.
      google: {},
      firecrawl: {},
      tavily: {},
      limitations: [
        ...(time || hasDates ? ['time' as const] : []),
        ...(domains ? ['domains' as const] : []),
        ...(options.lang ? ['language' as const] : []),
      ],
    }
  if (provider === 'crw')
    return {
      google: {},
      firecrawl: {},
      tavily: {},
      limitations: [
        ...(options.intent === 'news' ? ['news' as const] : []),
        ...(time || hasDates ? ['time' as const] : []),
        ...(domains ? ['domains' as const] : []),
        ...(options.lang ? ['language' as const] : []),
      ],
    }
  if (provider === 'firecrawl')
    return {
      google: {},
      tavily: {},
      firecrawl: {
        sources: [options.intent === 'news' ? ('news' as const) : ('web' as const)],
        tbs,
        includeDomains: domains,
      },
      limitations: options.lang ? ['language' as const] : [],
    }
  return {
    google: {},
    firecrawl: {},
    tavily: {
      topic: options.intent,
      timeRange: hasDates ? undefined : time,
      start_date: options.startDate,
      end_date: options.endDate,
      includeDomains: domains,
      language: options.lang,
    },
    limitations: [],
  }
}

async function searchWithFirecrawlCompatible(
  config: WebSearchConfig,
  query: string,
  options: WebSearchOptions,
): Promise<WebSearchResult[]> {
  const apiUrl = resolveWebSearchApiBase(config.provider, config.apiBase)
  if (!apiUrl) {
    throw new Error(`API base URL is required for provider ${config.provider}`)
  }

  const fc = new Firecrawl({
    apiKey: config.apiKey,
    apiUrl,
  })

  // v2 SDK: `search` throws on error and returns results grouped by
  // source (`web`/`news`/`images`); `maxResults` was renamed to `limit`.
  const results = await abortable(
    fc.search(query, {
      ...buildSearchFilters(config.provider, options).firecrawl,
      limit: options.maxResults ?? 5,
      scrapeOptions: {
        formats: ['markdown'],
      },
    }),
    options.signal,
  )

  return mapFirecrawlResults([...(results.web ?? []), ...(results.news ?? [])])
}

async function searchWithGooglePse(
  config: WebSearchConfig,
  query: string,
  options: WebSearchOptions,
): Promise<WebSearchResult[]> {
  const apiKey = config.apiKey
  const pseId = config.googlePseId
  if (!apiKey || !pseId) {
    throw new Error('Google PSE API key or ID not set')
  }

  // Ref: https://developers.google.com/custom-search/v1/using_rest
  const searchParams = new URLSearchParams({
    key: apiKey,
    cx: pseId,
    q: query,
    num: (options.maxResults ?? 5).toString(),
  })
  for (const [key, value] of Object.entries(buildSearchFilters('google-pse', options).google)) {
    searchParams.set(key, value)
  }

  const apiUrl = `https://www.googleapis.com/customsearch/v1?${searchParams.toString()}`

  try {
    const response = await fetch(apiUrl, { signal: options.signal })
    const data = (await response.json()) as {
      items?: Array<{ title: string; link: string; snippet: string }>
      error?: { message?: string }
    }

    if (!response.ok) {
      throw new Error(data.error?.message || `HTTP ${response.status}`)
    }

    if (!data.items) {
      return []
    }

    return data.items.map((item) => ({
      content: item.snippet,
      sourceType: 'search-result' as const,
      url: item.link,
      title: item.title,
    }))
  } catch (error: unknown) {
    if (options.signal?.aborted || isAbortError(error)) throw error
    console.error('Google PSE search failed:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    throw new Error(`Google PSE Error: ${message}`)
  }
}

async function searchWithTavily(
  config: WebSearchConfig,
  query: string,
  options: WebSearchOptions,
): Promise<WebSearchResult[]> {
  const tvly = tavily({
    apiKey: config.apiKey,
  })
  const results = await abortable(
    tvly.search(query, {
      maxResults: options.maxResults ?? 5,
      searchDepth: config.tavilyAdvancedSearch ? 'advanced' : 'basic',
      ...buildSearchFilters('tavily', options).tavily,
      topic: options.intent ?? config.tavilySearchTopic,
    }),
    options.signal,
  )
  return results.results
    .filter((x) => !!x?.content && !!x.url)
    .map((r) => ({
      content: r.content,
      sourceType: 'search-result' as const,
      url: r.url,
      title: r.title,
      publishedAt: r.publishedDate,
      score: r.score,
    }))
}

/**
 * You.com Web Search API.
 *
 * Two endpoints, selected by the presence of an API key:
 * - Keyed: `https://ydc-index.io/v1/search` with `X-API-Key` (higher limits)
 * - Keyless: `https://api.you.com/v1/agents/search` (limited daily quota per
 *   IP; returns 402 once exhausted, which we surface as an error)
 *
 * Response shape (`results.web` and, for news-intent queries, `results.news`):
 * items carry `url`, `title`, `description`, `snippets` (excerpts) and
 * `page_age`. `description` is a curated summary while `snippets` are page
 * excerpts, so both are joined into the result content.
 */
async function searchWithYoucom(
  config: WebSearchConfig,
  query: string,
  options: WebSearchOptions,
): Promise<WebSearchResult[]> {
  const usingKey = !!config.apiKey
  const apiUrl = new URL(usingKey ? YOUCOM_KEYED_SEARCH_URL : YOUCOM_KEYLESS_SEARCH_URL)
  apiUrl.searchParams.set('query', query)
  apiUrl.searchParams.set('count', (options.maxResults ?? 5).toString())

  const headers: Record<string, string> = {
    Accept: 'application/json',
    // Pin identity encoding: the keyless endpoint can advertise gzip with
    // body bytes that Node's decoder rejects.
    'Accept-Encoding': 'identity',
  }
  if (usingKey) headers['X-API-Key'] = config.apiKey!

  try {
    const response = await abortable(fetch(apiUrl, { headers }), options.signal)
    if (!response.ok) {
      let message = `HTTP ${response.status}`
      try {
        const body = (await response.json()) as { error?: { message?: string } }
        if (body.error?.message) message = `${message}: ${body.error.message}`
      } catch {
        // Body is not JSON; keep the status-only message.
      }
      throw new Error(`You.com search failed (${usingKey ? 'keyed' : 'keyless'}): ${message}`)
    }

    const data = (await response.json()) as {
      results?: {
        web?: YoucomSearchResult[]
        news?: YoucomSearchResult[]
      }
    }
    const webResults = data.results?.web ?? []
    const newsResults = data.results?.news ?? []

    return [...webResults, ...newsResults]
      .map((r) => {
        const content = [r.description, ...(r.snippets ?? [])].filter(Boolean).join('\n').trim()
        if (!r.url || !content) return undefined
        return {
          content,
          sourceType: 'search-result' as const,
          url: r.url,
          title: r.title,
          publishedAt: r.page_age,
        }
      })
      .filter((r): r is WebSearchResult => !!r)
  } catch (error: unknown) {
    if (options.signal?.aborted || isAbortError(error)) throw error
    console.error('You.com search failed:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    throw new Error(`You.com Error: ${message}`)
  }
}

/** Run a single web search with the given provider config. */
export async function searchWeb(
  config: WebSearchConfig,
  query: string,
  options: WebSearchOptions = {},
): Promise<WebSearchResult[]> {
  const constraints = searchConstraintsSchema.parse(options)
  options = { ...options, ...resolveSearchPlan({ ...constraints, query, researchGoal: '' }) }
  options.onNotice?.(buildSearchFilters(config.provider, options).limitations)
  switch (config.provider) {
    case 'firecrawl':
    case 'crw':
      return searchWithFirecrawlCompatible(config, query, options)
    case 'google-pse':
      return searchWithGooglePse(config, query, options)
    case 'youcom':
      return searchWithYoucom(config, query, options)
    case 'tavily':
    default:
      return searchWithTavily(config, query, options)
  }
}

/** Create a reusable search function bound to a fixed config snapshot. */
export function createWebSearch(config: WebSearchConfig): WebSearchFunction {
  const search: WebSearchFunction = (query, options) => searchWeb(config, query, options)
  search.readSource = createReadSource(config)
  search.provider = config.provider
  return search
}

/** Capability is explicit: CRW search compatibility does not imply scrape support. */
export function createReadSource(config: WebSearchConfig): ReadSourceFunction | undefined {
  if (config.provider === 'tavily')
    return async (url, { signal }) => {
      const response = await abortable(
        tavily({ apiKey: config.apiKey }).extract([url], {
          extractDepth: 'basic',
          timeout: 15,
        }),
        signal,
      )
      const result = response.results[0]
      if (!result?.rawContent) return undefined
      return { url, finalUrl: result.url, content: result.rawContent, sourceType: 'page' }
    }
  if (config.provider === 'firecrawl')
    return async (url, { signal }) => {
      const client = new Firecrawl({
        apiKey: config.apiKey,
        apiUrl: resolveWebSearchApiBase('firecrawl', config.apiBase),
      })
      const result = await abortable(
        client.scrape(url, {
          formats: ['markdown'],
          onlyMainContent: true,
          timeout: 15_000,
        }),
        signal,
      )
      if (!result.markdown) return undefined
      return {
        url,
        finalUrl: result.metadata?.sourceURL ?? url,
        title: result.metadata?.title,
        content: result.markdown,
        sourceType: 'page',
      }
    }
  return undefined
}
