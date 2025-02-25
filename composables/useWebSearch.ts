import { tavily } from '@tavily/core'
import Firecrawl from '@mendable/firecrawl-js'

type WebSearchOptions = {
  maxResults?: number
  /** The search language, e.g. `en`. Only works for Firecrawl. */
  lang?: string
}

export type WebSearchResult = {
  content: string
  url: string
  title?: string
}

type WebSearchFunction = (
  query: string,
  options: WebSearchOptions,
) => Promise<WebSearchResult[]>

export const useWebSearch = (): WebSearchFunction => {
  const { config, webSearchApiBase } = useConfigStore()

  switch (config.webSearch.provider) {
    case 'firecrawl': {
      const fc = new Firecrawl({
        apiKey: config.webSearch.apiKey,
        apiUrl: webSearchApiBase,
      })
      return async (q: string, o: WebSearchOptions) => {
        const results = await fc.search(q, {
          ...o,
          scrapeOptions: {
            formats: ['markdown']
          }
        })
        if (results.error) {
          throw new Error(results.error)
        }
        return results.data
          .filter((x) => !!x?.markdown && !!x.url)
          .map((r) => ({
            content: r.markdown!,
            url: r.url!,
            title: r.title,
          }))
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
          searchDepth: config.webSearch.tavilyAdvancedSearch
            ? 'advanced'
            : 'basic',
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
