import { deepResearch } from '~~/lib/core/deep-research'
import pLimit from 'p-limit'
import type { ConfigAi, ConfigWebSearch } from '~~/shared/types/config'
import { RuntimeConfig } from 'nuxt/schema'
import fs from 'node:fs'
import path from 'node:path'

// --- ApiKeyPool with File-based State Persistence ---

interface ApiKeyConfig {
  key: string
  active: boolean
  errorCount: number
  maxErrors: number
}

interface ApiPoolState {
  currentIndex: number
  keys: ApiKeyConfig[]
}

class ApiKeyPool {
  private state: ApiPoolState
  private readonly cacheFilePath: string
  private readonly initialKeys: string[]

  constructor(keys: string[], providerName: string) {
    this.initialKeys = keys
    const cacheDir = path.join(process.cwd(), '.cache')
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true })
    }
    this.cacheFilePath = path.join(cacheDir, `keypool_${providerName}.json`)

    this.state = this.loadState()

    const envKeySet = new Set(keys)
    const stateKeySet = new Set(this.state.keys.map((k) => k.key))

    if (
      this.state.keys.length !== keys.length ||
      ![...envKeySet].every((k) => stateKeySet.has(k))
    ) {
      this.state = {
        currentIndex: 0,
        keys: keys.map((key) => ({
          key,
          active: true,
          errorCount: 0,
          maxErrors: 5,
        })),
      }
      this.saveState()
    }
  }

  private loadState(): ApiPoolState {
    try {
      if (fs.existsSync(this.cacheFilePath)) {
        const data = fs.readFileSync(this.cacheFilePath, 'utf8')
        return JSON.parse(data)
      }
    } catch (error: any) {
      console.error(
        `[ApiKeyPool] Warning: Could not read cache file for ${this.cacheFilePath}. Starting fresh.`,
        error.message,
      )
    }
    return { currentIndex: 0, keys: [] }
  }

  private saveState() {
    try {
      fs.writeFileSync(this.cacheFilePath, JSON.stringify(this.state, null, 2))
    } catch (error: any) {
      console.error(
        `[ApiKeyPool] Error: Could not write to cache file for ${this.cacheFilePath}.`,
        error.message,
      )
    }
  }

  getNextKey(): ApiKeyConfig | null {
    const activeKeys = this.state.keys.filter((k) => k.active)
    if (activeKeys.length === 0) {
      return null
    }
    if (this.state.currentIndex >= activeKeys.length) {
      this.state.currentIndex = 0
    }
    const keyConfig = activeKeys[this.state.currentIndex]
    this.state.currentIndex = (this.state.currentIndex + 1) % activeKeys.length
    this.saveState()
    return keyConfig
  }

  markKeyError(key: string) {
    const keyConfig = this.state.keys.find((k) => k.key === key)
    if (keyConfig) {
      keyConfig.errorCount++
      if (keyConfig.errorCount >= keyConfig.maxErrors) {
        keyConfig.active = false
        console.error(
          `[ApiKeyPool] Disabling key due to multiple errors: ${key.substring(0, 8)}...`,
        )
      }
      this.saveState()
    }
  }

  markKeySuccess(key: string) {
    const keyConfig = this.state.keys.find((k) => k.key === key)
    if (keyConfig) {
      if (keyConfig.errorCount > 0) {
        keyConfig.errorCount = 0
        this.saveState()
      }
    }
  }
}

let apiKeyPool: ApiKeyPool | undefined
let googleApiKeyPool: ApiKeyPool | undefined

export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig()
  const body = await readBody(event)

  const {
    query,
    breadth,
    depth,
    languageCode,
    searchLanguageCode,
    learnings = [],
    currentDepth = 1,
    nodeId = '0',
    retryNode,
  } = body

  // Validate required parameters
  if (!query || !breadth || !depth || !languageCode) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing required parameters',
    })
  }

  // Create server-side configuration
  const serverConfig: ConfigAi = {
    provider: runtimeConfig.public.aiProvider as ConfigAi['provider'],
    apiKey: runtimeConfig.aiApiKey,
    apiBase: runtimeConfig.aiApiBase,
    model: runtimeConfig.public.aiModel,
    contextSize: runtimeConfig.public.aiContextSize,
  }

  // Create server-side web search function
  const serverWebSearch = await createServerWebSearch(runtimeConfig)

  // Create server-side pLimit instance
  const serverPLimit = pLimit(runtimeConfig.public.webSearchConcurrencyLimit)

  // Set response headers for streaming
  setHeader(event, 'Content-Type', 'text/event-stream')
  setHeader(event, 'Cache-Control', 'no-cache')
  setHeader(event, 'Connection', 'keep-alive')

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()

      const onProgress = (step: any) => {
        const data = `data: ${JSON.stringify(step)}\n\n`
        controller.enqueue(encoder.encode(data))
      }

      deepResearch({
        query,
        breadth,
        maxDepth: depth,
        languageCode,
        aiConfig: serverConfig,
        searchLanguageCode,
        learnings,
        currentDepth,
        nodeId,
        retryNode,
        onProgress,
        webSearchFunction: serverWebSearch,
        pLimitInstance: serverPLimit,
      })
        .then((result) => {
          controller.close()
        })
        .catch((error) => {
          const errorData = `data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`
          controller.enqueue(encoder.encode(errorData))
          controller.close()
        })
    },
  })

  return sendStream(event, stream)
})

async function createServerWebSearch(runtimeConfig: RuntimeConfig) {
  // Import server-side web search implementation
  const { tavily } = await import('@tavily/core')
  const { default: Firecrawl } = await import('@mendable/firecrawl-js')

  return async (
    query: string,
    options: { maxResults?: number; lang?: string },
  ) => {
    const provider = runtimeConfig.public.webSearchProvider
    const apiKey = runtimeConfig.webSearchApiKey
    const apiBase = runtimeConfig.webSearchApiBase

    switch (provider) {
      case 'firecrawl': {
        const fc = new Firecrawl({
          apiKey,
          apiUrl: apiBase || 'https://api.firecrawl.dev',
        })
        const results = await fc.search(query, {
          maxResults: options.maxResults || 5,
          scrapeOptions: {
            formats: ['markdown'],
          },
        })
        if (results.error) {
          throw new Error(results.error)
        }
        return results.data
          .filter((x: any) => !!x?.markdown && !!x.url)
          .map((r: any) => ({
            content: r.markdown!,
            url: r.url!,
            title: r.title,
          }))
      }

      case 'google-pse': {
        const pseId = runtimeConfig.public.googlePseId
        if (!pseId) {
          throw new Error(
            'NUXT_PUBLIC_GOOGLE_PSE_ID environment variable not set.',
          )
        }

        if (!googleApiKeyPool) {
          const apiKeysEnv = runtimeConfig.webSearchApiKey
          if (!apiKeysEnv) {
            throw new Error(
              'NUXT_WEB_SEARCH_API_KEY environment variable not set for Google PSE.',
            )
          }
          const keys = apiKeysEnv
            .split(',')
            .map((key: string) => key.trim())
            .filter((key: string) => key)
          if (keys.length === 0) {
            throw new Error(
              'NUXT_WEB_SEARCH_API_KEY environment variable is empty or contains only commas.',
            )
          }
          googleApiKeyPool = new ApiKeyPool(keys, 'google-pse')
        }

        const selectedKeyConfig = googleApiKeyPool.getNextKey()
        if (!selectedKeyConfig) {
          throw new Error('No active Google PSE API keys available.')
        }
        const currentApiKey = selectedKeyConfig.key

        try {
          const searchParams = new URLSearchParams({
            key: currentApiKey,
            cx: pseId,
            q: query,
            num: (options.maxResults || 5).toString(),
          })
          if (options.lang) {
            searchParams.append('lr', `lang_${options.lang}`)
          }

          const apiUrl = `https://www.googleapis.com/customsearch/v1?${searchParams.toString()}`
          const response = (await $fetch(apiUrl, { method: 'GET' })) as any

          if (!response.items) {
            googleApiKeyPool.markKeySuccess(currentApiKey)
            return []
          }

          googleApiKeyPool.markKeySuccess(currentApiKey)
          return response.items.map((item: any) => ({
            content: item.snippet,
            url: item.link,
            title: item.title,
          }))
        } catch (e) {
          googleApiKeyPool.markKeyError(currentApiKey)
          throw e
        }
      }

      case 'tavily':
      default: {
        if (!apiKeyPool) {
          const apiKeysEnv = runtimeConfig.webSearchApiKey
          if (!apiKeysEnv) {
            throw new Error(
              'NUXT_WEB_SEARCH_API_KEY environment variable not set.',
            )
          }
          const keys = apiKeysEnv
            .split(',')
            .map((key: string) => key.trim())
            .filter((key: string) => key)
          if (keys.length === 0) {
            throw new Error(
              'NUXT_WEB_SEARCH_API_KEY environment variable is empty or contains only commas.',
            )
          }
          apiKeyPool = new ApiKeyPool(keys, 'tavily')
        }

        const selectedKeyConfig = apiKeyPool.getNextKey()
        if (!selectedKeyConfig) {
          throw new Error('No active Tavily API keys available.')
        }
        const currentApiKey = selectedKeyConfig.key

        try {
          const tvly = tavily({
            apiKey: currentApiKey,
          })
          const results = await tvly.search(query, {
            maxResults: options.maxResults || 5,
            searchDepth: runtimeConfig.public.tavilyAdvancedSearch
              ? 'advanced'
              : 'basic',
            topic: runtimeConfig.public
              .tavilySearchTopic as ConfigWebSearch['tavilySearchTopic'],
          })
          apiKeyPool.markKeySuccess(currentApiKey)
          return results.results
            .filter((x: any) => !!x?.content && !!x.url)
            .map((r: any) => ({
              content: r.content,
              url: r.url,
              title: r.title,
            }))
        } catch (e) {
          apiKeyPool.markKeyError(currentApiKey)
          throw e
        }
      }
    }
  }
}
