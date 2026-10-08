export type ConfigAiProvider =
  | 'openai-compatible'
  | 'siliconflow'
  | '302-ai'
  | 'openrouter'
  | 'requesty'
  | 'deepseek'
  | 'ollama'
  | 'litellm'

export type ConfigWebSearchProvider =
  'tavily' | 'firecrawl' | 'crw' | 'google-pse' | 'youcom' | 'parallel' | 'serply'

export interface ConfigAi {
  provider: ConfigAiProvider
  apiKey?: string
  apiBase?: string
  model: string
  contextSize?: number
  /**
   * Hard cap on generated tokens, including reasoning. Unset leaves the limit to the provider,
   * since reasoning models can spend any fixed budget on thinking alone.
   */
  maxOutputTokens?: number
  /**
   * Custom fetch implementation (server-only). Used to route AI provider
   * requests through an outbound proxy. Never set in the browser.
   */
  fetch?: typeof fetch
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
  aiMaxOutputTokens: number
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
  aiMaxOutputTokens: number
  webSearchProvider: ConfigWebSearchProvider
  webSearchConcurrencyLimit: number
  webSearchSearchLanguage: string
  tavilyAdvancedSearch: boolean
  tavilySearchTopic: 'general' | 'news' | 'finance'
  googlePseId?: string
}
