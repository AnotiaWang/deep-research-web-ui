import { abortable, isAbortError } from '~~/shared/utils/abort'
import type { ReadSourceFunction } from '~~/lib/core/read-source'
import type { WebSearchConfig, WebSearchOptions } from '~~/lib/core/web-search'
import type { SearchLimitation } from '~~/shared/utils/search-plan'
import type { WebSearchResult } from '~~/shared/types/types'

/**
 * Keenable search and page reading.
 *
 * Two endpoint pairs, selected by the presence of an API key:
 * - Keyed: `POST /v1/search` and `GET /v1/fetch` with `X-API-Key`
 * - Keyless: `POST /v1/search/public` and `GET /v1/fetch/public` with an
 *   `X-Keenable-Title` header naming the app (shared per-IP limit)
 *
 * Search returns `{ results: [{ url, title, description, snippet, published_at }] }`;
 * fetch returns `{ url, title, content }` with the page as markdown.
 * Ref: https://docs.keenable.ai/api-reference
 */
const KEENABLE_API_BASE = 'https://api.keenable.ai/v1'
const KEENABLE_APP_TITLE = 'deep-research-web-ui'
const MAX_RESULTS = 50
const READ_TIMEOUT_MS = 15_000

/** Single item from the Keenable search API `results` array. */
interface KeenableSearchResult {
  url?: string
  title?: string
  description?: string
  snippet?: string
  published_at?: string
}

export interface KeenableFilters {
  site?: string
  published_after?: string
  published_before?: string
}

/** Keeps the HTTP status so the server key pool can tell key failures from outages. */
function httpError(message: string, status: number) {
  return Object.assign(new Error(message), { status })
}

function headers(apiKey?: string): Record<string, string> {
  return apiKey
    ? { 'X-API-Key': apiKey, Accept: 'application/json' }
    : { 'X-Keenable-Title': KEENABLE_APP_TITLE, Accept: 'application/json' }
}

function endpoint(path: 'search' | 'fetch', apiKey?: string) {
  return `${KEENABLE_API_BASE}/${path}${apiKey ? '' : '/public'}`
}

async function errorMessage(response: Response) {
  let message = `HTTP ${response.status}`
  try {
    const body = (await response.json()) as { message?: string; error?: string }
    const detail = body.message || body.error
    if (detail) message = `${message}: ${detail}`
  } catch {
    // Body is not JSON; keep the status-only message.
  }
  return message
}

/** The day after a YYYY-MM-DD date, so `endDate` stays inclusive. */
function nextDay(date: string) {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + 1)
  return value.toISOString().slice(0, 10)
}

/** Native site and publish-date filters; news intent, several domains and language are not mapped. */
export function buildKeenableFilters(options: WebSearchOptions): {
  keenable: KeenableFilters
  limitations: SearchLimitation[]
} {
  const keenable: KeenableFilters = {}
  const limitations: SearchLimitation[] = []
  if (options.intent === 'news') limitations.push('news')
  if (options.startDate || options.endDate) {
    if (options.startDate) keenable.published_after = options.startDate
    if (options.endDate) keenable.published_before = nextDay(options.endDate)
  } else if (options.timeRange) {
    keenable.published_after = { day: '1d', week: '7d', month: '1mo', year: '1y' }[
      options.timeRange
    ]
  }
  const domains = options.includeDomains ?? []
  if (domains.length === 1) keenable.site = domains[0]
  else if (domains.length > 1) limitations.push('domains')
  if (options.lang) limitations.push('language')
  return { keenable, limitations }
}

export async function searchWithKeenable(
  config: WebSearchConfig,
  query: string,
  options: WebSearchOptions,
): Promise<WebSearchResult[]> {
  const apiKey = config.apiKey?.trim() || undefined
  const maxResults = options.maxResults ?? 5
  const body = {
    query,
    max_results: Math.min(Math.max(maxResults, 1), MAX_RESULTS),
    ...buildKeenableFilters(options).keenable,
  }

  try {
    const doFetch = config.fetch ?? fetch
    const response = await abortable(
      doFetch(endpoint('search', apiKey), {
        method: 'POST',
        headers: { ...headers(apiKey), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: options.signal,
      }),
      options.signal,
    )
    if (!response.ok) {
      throw httpError(
        `Keenable search failed (${apiKey ? 'keyed' : 'keyless'}): ${await errorMessage(response)}`,
        response.status,
      )
    }

    const data = (await response.json()) as { results?: KeenableSearchResult[] }
    return (data.results ?? [])
      .flatMap<WebSearchResult>((r) => {
        const content = (r.snippet || r.description || '').trim()
        if (!r.url || !content) return []
        return [
          {
            content,
            sourceType: 'search-result',
            url: r.url,
            ...(r.title ? { title: r.title } : {}),
            ...(r.published_at ? { publishedAt: r.published_at } : {}),
          },
        ]
      })
      .slice(0, maxResults)
  } catch (error: unknown) {
    if (options.signal?.aborted || isAbortError(error)) throw error
    console.error('Keenable search failed:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    throw new Error(`Keenable Error: ${message}`, { cause: error })
  }
}

/** Read one page as markdown through Keenable's fetch endpoint. */
export function createKeenableReadSource(config: WebSearchConfig): ReadSourceFunction {
  return async (url, { signal }) => {
    const apiKey = config.apiKey?.trim() || undefined
    const apiUrl = new URL(endpoint('fetch', apiKey))
    apiUrl.searchParams.set('url', url)
    const doFetch = config.fetch ?? fetch
    const requestSignal = AbortSignal.any([
      AbortSignal.timeout(READ_TIMEOUT_MS),
      ...(signal ? [signal] : []),
    ])
    const response = await abortable(
      doFetch(apiUrl, { headers: headers(apiKey), signal: requestSignal }),
      signal,
    )
    if (!response.ok) {
      throw httpError(`Keenable fetch failed: ${await errorMessage(response)}`, response.status)
    }
    const data = (await response.json()) as { url?: string; title?: string; content?: string }
    if (!data.content?.trim()) return undefined
    return {
      url,
      finalUrl: data.url ?? url,
      ...(data.title ? { title: data.title } : {}),
      content: data.content,
      sourceType: 'page',
    }
  }
}
