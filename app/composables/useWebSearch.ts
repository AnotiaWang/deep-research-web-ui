import { createWebSearch, type WebSearchFunction } from '~~/lib/core/web-search'

export const useWebSearch = (): WebSearchFunction => {
  const { config, webSearchApiBase } = useConfigStore()

  return createWebSearch({
    provider: config.webSearch.provider,
    apiKey: config.webSearch.apiKey,
    apiBase: webSearchApiBase,
    googlePseId: config.webSearch.googlePseId,
    tavilyAdvancedSearch: config.webSearch.tavilyAdvancedSearch,
    tavilySearchTopic: config.webSearch.tavilySearchTopic,
  })
}
