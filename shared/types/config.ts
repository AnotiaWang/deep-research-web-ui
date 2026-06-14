export type ConfigAiProvider =
  | 'openai-compatible'
  | 'siliconflow'
  | '302-ai'
  | 'infiniai'
  | 'openrouter'
  | 'deepseek'
  | 'ollama'

export type ConfigWebSearchProvider = 'tavily' | 'firecrawl' | 'crw' | 'google-pse'

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
  searchLanguage?: string
  /** Limit the number of concurrent tasks globally */
  concurrencyLimit?: number
  /** Tavily: use advanced search to retrieve higher quality results */
  tavilyAdvancedSearch?: boolean
  /** Tavily: search topic. Defaults to `general` */
  tavilySearchTopic?: 'general' | 'news' | 'finance'
  googlePseId?: string // Google PSE ID
}

export interface Config {
  ai: ConfigAi
  webSearch: ConfigWebSearch
}

export interface ServerRuntimeConfig {
  aiProvider: ConfigAiProvider
  aiModel: string
  aiContextSize: number
  aiApiKey: string
  aiApiBase?: string
  webSearchProvider: ConfigWebSearchProvider
  webSearchApiKey: string
  webSearchApiBase?: string
  webSearchConcurrencyLimit: number
  webSearchSearchLanguage: string
  tavilyAdvancedSearch: boolean
  tavilySearchTopic: 'general' | 'news' | 'finance'
  googlePseId?: string
}

export interface PublicRuntimeConfig {
  serverMode: boolean
  aiProvider: ConfigAiProvider
  aiModel: string
  aiContextSize: number
  webSearchProvider: ConfigWebSearchProvider
  webSearchConcurrencyLimit: number
  webSearchSearchLanguage: string
  tavilyAdvancedSearch: boolean
  tavilySearchTopic: 'general' | 'news' | 'finance'
  googlePseId?: string
}
