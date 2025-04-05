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
            formats: ['markdown'], // TODO: verify if this actually works
          },
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
          num: o.maxResults?.toString() || '5', // Default to 5 results if not specified
          // Add other params like 'lr' based on lang if needed: o.lang ? `lang_${o.lang}` : undefined
        });
        if (o.lang) {
          searchParams.append('lr', `lang_${o.lang}`); // Adjust language parameter format as needed by PSE API
        }

        const apiUrl = `https://www.googleapis.com/customsearch/v1?${searchParams.toString()}`;

        try {
          const response = await $fetch<{ items?: Array<{ title: string; link: string; snippet: string }> }>(apiUrl, { method: 'GET' });

          if (!response.items) {
            return [];
          }

          // Map response to WebSearchResult format
          return response.items.map((item) => ({
            content: item.snippet, // Use snippet as content
            url: item.link,
            title: item.title,
          }));
        } catch (error: any) {
          console.error('Google PSE search failed:', error);
          // Attempt to parse Google API error format
          const errorMessage = error?.data?.error?.message || error.message || 'Unknown error';
          throw new Error(`Google PSE Error: ${errorMessage}`);
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
