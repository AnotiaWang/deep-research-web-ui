import { tavily } from '@tavily/core'
import Firecrawl, { type Document, type SearchResultWeb } from '@mendable/firecrawl-js'
import { abortable, isAbortError } from '~~/shared/utils/abort'
import type { ConfigWebSearchProvider } from '~~/shared/types/config'
import type { WebSearchResult } from '~~/shared/types/types'

export type WebSearchOptions = {
  maxResults?: number
  /** The search language, e.g. `en`. Only works for Firecrawl / Google PSE. */
  lang?: string
  signal?: AbortSignal
}

export type WebSearchFunction = (
  query: string,
  options: WebSearchOptions,
) => Promise<WebSearchResult[]>

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
  // tavily / google-pse do not use a configurable API base in this project
  return undefined
}

function mapFirecrawlResults(
  web: Array<Document | SearchResultWeb> | undefined,
): WebSearchResult[] {
  // With `scrapeOptions`, web results are scraped `Document`s carrying
  // `markdown` plus top-level `url`/`title` (and a `metadata` fallback).
  return (web ?? [])
    .map((r) => r as Document & SearchResultWeb)
    .filter((r) => !!r.markdown && !!(r.url ?? r.metadata?.sourceURL))
    .map((r) => ({
      content: r.markdown!,
      url: (r.url ?? r.metadata?.sourceURL)!,
      title: r.title ?? r.metadata?.title,
    }))
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
      limit: options.maxResults ?? 5,
      scrapeOptions: {
        formats: ['markdown'],
      },
    }),
    options.signal,
  )

  return mapFirecrawlResults(results.web)
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
  if (options.lang) {
    searchParams.append('lr', `lang_${options.lang}`)
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
      topic: config.tavilySearchTopic,
    }),
    options.signal,
  )
  return results.results
    .filter((x) => !!x?.content && !!x.url)
    .map((r) => ({
      content: r.content,
      url: r.url,
      title: r.title,
    }))
}

/** Run a single web search with the given provider config. */
export async function searchWeb(
  config: WebSearchConfig,
  query: string,
  options: WebSearchOptions = {},
): Promise<WebSearchResult[]> {
  switch (config.provider) {
    case 'firecrawl':
    case 'crw':
      return searchWithFirecrawlCompatible(config, query, options)
    case 'google-pse':
      return searchWithGooglePse(config, query, options)
    case 'tavily':
    default:
      return searchWithTavily(config, query, options)
  }
}

/** Create a reusable search function bound to a fixed config snapshot. */
export function createWebSearch(config: WebSearchConfig): WebSearchFunction {
  return (query, options) => searchWeb(config, query, options)
}
