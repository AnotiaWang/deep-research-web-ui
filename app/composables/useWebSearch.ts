import { tavily } from '@tavily/core'
import Firecrawl, { type Document, type SearchResultWeb } from '@mendable/firecrawl-js'

type WebSearchOptions = {
  maxResults?: number
  /** The search language, e.g. `en`. Only works for Firecrawl. */
  lang?: string
}

type WebSearchFunction = (query: string, options: WebSearchOptions) => Promise<WebSearchResult[]>

export const useWebSearch = (): WebSearchFunction => {
  const { config, webSearchApiBase } = useConfigStore()

  switch (config.webSearch.provider) {
    case 'firecrawl':
    // fastCRW is a Firecrawl-compatible web scraper (single binary; self-host or cloud).
    // It uses the same client; only the base URL differs (see webSearchApiBase).
    case 'crw': {
      const fc = new Firecrawl({
        apiKey: config.webSearch.apiKey,
        apiUrl: webSearchApiBase,
      })
      return async (q: string, o: WebSearchOptions) => {
        // v2 SDK: `search` throws on error and returns results grouped by
        // source (`web`/`news`/`images`) instead of the old flat `data` array.
        // `maxResults` was renamed to `limit`.
        const results = await fc.search(q, {
          limit: o.maxResults,
          scrapeOptions: {
            formats: ['markdown'],
          },
        })
        // With `scrapeOptions`, web results are scraped `Document`s carrying
        // `markdown` plus top-level `url`/`title` (and a `metadata` fallback).
        return (results.web ?? [])
          .map((r) => r as Document & SearchResultWeb)
          .filter((r) => !!r.markdown && !!(r.url ?? r.metadata?.sourceURL))
          .map((r) => ({
            content: r.markdown!,
            url: (r.url ?? r.metadata?.sourceURL)!,
            title: r.title ?? r.metadata?.title,
          }))
      }
    }
    case 'google-pse': {
      const apiKey = config.webSearch.apiKey
      const pseId = config.webSearch.googlePseId

      return async (q: string, o: WebSearchOptions) => {
        if (!apiKey || !pseId) {
          throw new Error('Google PSE API key or ID not set')
        }

        // Construct Google PSE API URL
        // Ref: https://developers.google.com/custom-search/v1/using_rest
        const searchParams = new URLSearchParams({
          key: apiKey,
          cx: pseId,
          q: q,
          num: o.maxResults?.toString() || '5',
        })
        if (o.lang) {
          searchParams.append('lr', `lang_${o.lang}`)
        }

        const apiUrl = `https://www.googleapis.com/customsearch/v1?${searchParams.toString()}`

        try {
          const response = await $fetch<{
            items?: Array<{ title: string; link: string; snippet: string }>
          }>(apiUrl, {
            method: 'GET',
          })

          if (!response.items) {
            return []
          }

          // Map response to WebSearchResult format
          return response.items.map((item) => ({
            content: item.snippet, // Use snippet as content
            url: item.link,
            title: item.title,
          }))
        } catch (error: any) {
          console.error('Google PSE search failed:', error)
          // Attempt to parse Google API error format
          const errorMessage = error?.data?.error?.message || error.message || 'Unknown error'
          throw new Error(`Google PSE Error: ${errorMessage}`)
        }
      }
    }
    case 'tavily':
    default: {
      const tvly = tavily({
        apiKey: config.webSearch.apiKey,
      })
      return async (q: string, o: WebSearchOptions) => {
        const results = await tvly.search(q, {
          ...o,
          searchDepth: config.webSearch.tavilyAdvancedSearch ? 'advanced' : 'basic',
          topic: config.webSearch.tavilySearchTopic,
        })
        return results.results
          .filter((x) => !!x?.content && !!x.url)
          .map((r) => ({
            content: r.content,
            url: r.url,
            title: r.title,
          }))
      }
    }
  }
}
