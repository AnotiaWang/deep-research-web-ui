import { skipHydrate } from 'pinia'
import { getApiBase } from '~~/shared/utils/ai-model'

export type ConfigAiProvider =
  | 'openai-compatible'
  | 'siliconflow'
  | 'infiniai'
  | 'openrouter'
  | 'deepseek'
  | 'ollama'

export type ConfigWebSearchProvider = 'tavily' | 'firecrawl' | 'google-pse'

export interface ConfigAi {
  provider: ConfigAiProvider
  apiKey?: string
  apiBase?: string
  model: string
  contextSize?: number
}
export interface ConfigWebSearch {
  provider: ConfigWebSearchProvider
  apiKey?: string
  /** API base. Currently only works with Firecrawl */
  apiBase?: string
  /** Force the LLM to generate serp queries in a certain language */
  searchLanguage?: Locale
  /** Limit the number of concurrent tasks globally */
  concurrencyLimit?: number
  /** Tavily: use advanced search to retrieve higher quality results */
  tavilyAdvancedSearch?: boolean
  /** Tavily: search topic. Defaults to `general` */
  tavilySearchTopic?: 'general' | 'news' | 'finance'
  googlePseId?: string; // Google PSE ID
}

export interface Config {
  ai: ConfigAi
  webSearch: ConfigWebSearch
}

function validateConfig(config: Config) {
  const ai = config.ai
  if (ai.provider !== 'ollama' && !ai.apiKey) return false
  if (typeof ai.contextSize !== 'undefined' && ai.contextSize < 0) return false

  const ws = config.webSearch
  if (ws.provider === 'tavily' && !ws.apiKey) return false
  // Either apiBase or apiKey is required for firecrawl
  if (ws.provider === 'firecrawl' && !ws.apiBase && !ws.apiKey) return false
  if (ws.provider === 'google-pse' && (!ws.apiKey || !ws.googlePseId)) return false; // Require API Key and PSE ID
  if (typeof ws.concurrencyLimit !== 'undefined' && ws.concurrencyLimit! < 1)
    return false
  return true
}

export const useConfigStore = defineStore('config', () => {
  const config = useLocalStorage<Config>('deep-research-config', {
    ai: {
      provider: 'openai-compatible',
      model: '',
      contextSize: 128_000,
    },
    webSearch: {
      provider: 'tavily',
      concurrencyLimit: 2,
    },
  } satisfies Config)
  // The version user dismissed the update notification
  const dismissUpdateVersion = useLocalStorage<string>(
    'dismiss-update-version',
    '',
  )
  const isConfigValid = computed(() => validateConfig(config.value))

  const aiApiBase = computed(() => getApiBase(config.value.ai))
  const webSearchApiBase = computed(() => {
    const { webSearch } = config.value
    if (webSearch.provider === 'tavily') {
      return
    }
    if (webSearch.provider === 'firecrawl') {
      return webSearch.apiBase || 'https://api.firecrawl.dev'
    }
  })

  const showConfigManager = ref(false)

  return {
    config: skipHydrate(config),
    isConfigValid,
    aiApiBase,
    webSearchApiBase,
    showConfigManager,
    dismissUpdateVersion: skipHydrate(dismissUpdateVersion),
  }
})
