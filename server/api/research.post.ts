import { deepResearch } from '~~/lib/core/deep-research'
import {
  createReadSource,
  searchWeb,
  type WebSearchFunction,
  type WebSearchOptions,
} from '~~/lib/core/web-search'
import pLimit from 'p-limit'
import type { ConfigAi, ConfigWebSearchProvider } from '~~/shared/types/config'
import type { RuntimeConfig } from 'nuxt/schema'
import fs from 'node:fs'
import path from 'node:path'
import { isAbortError } from '~~/shared/utils/abort'
import { researchRequestSchema } from '~~/shared/utils/research-input'

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
    const keyConfig = activeKeys[this.state.currentIndex]!
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
let youcomApiKeyPool: ApiKeyPool | undefined

export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig()
  const parsedBody = researchRequestSchema.safeParse(await readBody(event))
  if (!parsedBody.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid research request parameters',
      data: parsedBody.error.flatten(),
    })
  }

  const {
    query,
    breadth,
    depth,
    languageCode,
    searchLanguageCode,
    searchConstraints,
    sourceUrls,
    originalQuery,
    learnings = [],
    currentDepth = 1,
    nodeId = '0',
    retryNode,
  } = parsedBody.data

  // Create server-side configuration
  const serverConfig: ConfigAi = {
    provider: runtimeConfig.public.aiProvider as ConfigAi['provider'],
    apiKey: runtimeConfig.aiApiKey,
    apiBase: runtimeConfig.aiApiBase,
    model: runtimeConfig.public.aiModel,
    contextSize: runtimeConfig.public.aiContextSize,
  }

  // Create server-side web search function
  const serverWebSearch = createServerWebSearch(runtimeConfig)
  serverWebSearch.provider = runtimeConfig.public.webSearchProvider as ConfigWebSearchProvider

  // Create server-side pLimit instance
  const serverPLimit = pLimit(runtimeConfig.public.webSearchConcurrencyLimit)

  // Set response headers for streaming
  setHeader(event, 'Content-Type', 'text/event-stream')
  setHeader(event, 'Cache-Control', 'no-cache')
  setHeader(event, 'Connection', 'keep-alive')

  const requestAbort = createRequestAbort(
    event,
    serverOperationTimeout(runtimeConfig.public.researchResearchTimeoutMs),
  )

  const stream = new ReadableStream({
    async start(controller) {
      const writer = createSSEWriter(controller, requestAbort.canWrite)

      const onProgress = (step: any) => {
        if (requestAbort.signal.aborted) return
        writer.write(step)
      }

      try {
        await deepResearch({
          query,
          originalQuery,
          breadth,
          maxDepth: depth,
          languageCode,
          aiConfig: serverConfig,
          searchLanguageCode,
          searchConstraints,
          sourceUrls,
          learnings,
          currentDepth,
          nodeId,
          retryNode,
          onProgress,
          webSearchFunction: serverWebSearch,
          pLimitInstance: serverPLimit,
          signal: requestAbort.signal,
        })
      } catch (error) {
        if (!requestAbort.signal.aborted) {
          writer.write({
            type: 'error',
            message: error instanceof Error ? error.message : String(error),
            nodeId,
          })
        }
      } finally {
        if (requestAbort.reason() === 'timeout') {
          writer.write({
            type: 'error',
            code: 'timeout',
            message: 'The research request timed out.',
            nodeId,
          })
        }
        requestAbort.cleanup()
        writer.close()
      }
    },
    cancel() {
      requestAbort.abort('stream-cancel')
    },
  })

  return sendStream(event, stream)
})

function parseApiKeys(envValue: string | undefined, envName: string): string[] {
  if (!envValue) {
    throw new Error(`${envName} environment variable not set.`)
  }
  const keys = envValue
    .split(',')
    .map((key) => key.trim())
    .filter((key) => key)
  if (keys.length === 0) {
    throw new Error(`${envName} environment variable is empty or contains only commas.`)
  }
  return keys
}

function getOrCreateApiKeyPool(
  pool: ApiKeyPool | undefined,
  setPool: (next: ApiKeyPool) => void,
  providerName: string,
  runtimeConfig: RuntimeConfig,
): ApiKeyPool {
  if (pool) return pool
  const keys = parseApiKeys(runtimeConfig.webSearchApiKey, 'NUXT_WEB_SEARCH_API_KEY')
  const next = new ApiKeyPool(keys, providerName)
  setPool(next)
  return next
}

export function createServerWebSearch(runtimeConfig: RuntimeConfig): WebSearchFunction {
  const search: WebSearchFunction = async (query: string, options: WebSearchOptions) => {
    const provider = runtimeConfig.public.webSearchProvider as ConfigWebSearchProvider
    const sharedConfig = {
      provider,
      apiBase: runtimeConfig.webSearchApiBase,
      googlePseId: runtimeConfig.public.googlePseId,
      tavilyAdvancedSearch: runtimeConfig.public.tavilyAdvancedSearch,
      tavilySearchTopic: runtimeConfig.public.tavilySearchTopic as
        | 'general'
        | 'news'
        | 'finance'
        | undefined,
    }

    if (provider === 'firecrawl' || provider === 'crw') {
      return searchWeb(
        {
          ...sharedConfig,
          apiKey: runtimeConfig.webSearchApiKey,
        },
        query,
        options,
      )
    }

    if (provider === 'google-pse') {
      if (!runtimeConfig.public.googlePseId) {
        throw new Error('NUXT_PUBLIC_GOOGLE_PSE_ID environment variable not set.')
      }
      const pool = getOrCreateApiKeyPool(
        googleApiKeyPool,
        (next) => {
          googleApiKeyPool = next
        },
        'google-pse',
        runtimeConfig,
      )
      const selectedKeyConfig = pool.getNextKey()
      if (!selectedKeyConfig) {
        throw new Error('No active Google PSE API keys available.')
      }
      const currentApiKey = selectedKeyConfig.key
      try {
        const results = await searchWeb({ ...sharedConfig, apiKey: currentApiKey }, query, options)
        pool.markKeySuccess(currentApiKey)
        return results
      } catch (e) {
        if (options.signal?.aborted || isAbortError(e)) throw e
        pool.markKeyError(currentApiKey)
        throw e
      }
    }

    if (provider === 'youcom') {
      if (!runtimeConfig.webSearchApiKey?.trim()) {
        return searchWeb({ ...sharedConfig, apiKey: undefined }, query, options)
      }
      // You.com works keyless; when keys are configured, rotate them like
      // the other keyed providers (comma-separated NUXT_WEB_SEARCH_API_KEY).
      const pool = getOrCreateApiKeyPool(
        youcomApiKeyPool,
        (next) => {
          youcomApiKeyPool = next
        },
        'youcom',
        runtimeConfig,
      )
      const selectedKeyConfig = pool.getNextKey()
      if (!selectedKeyConfig) {
        throw new Error('No active You.com API keys available.')
      }
      const currentApiKey = selectedKeyConfig.key
      try {
        const results = await searchWeb({ ...sharedConfig, apiKey: currentApiKey }, query, options)
        pool.markKeySuccess(currentApiKey)
        return results
      } catch (e) {
        if (options.signal?.aborted || isAbortError(e)) throw e
        pool.markKeyError(currentApiKey)
        throw e
      }
    }

    // tavily (default)
    const pool = getOrCreateApiKeyPool(
      apiKeyPool,
      (next) => {
        apiKeyPool = next
      },
      'tavily',
      runtimeConfig,
    )
    const selectedKeyConfig = pool.getNextKey()
    if (!selectedKeyConfig) {
      throw new Error('No active Tavily API keys available.')
    }
    const currentApiKey = selectedKeyConfig.key
    try {
      const results = await searchWeb(
        { ...sharedConfig, provider: 'tavily', apiKey: currentApiKey },
        query,
        options,
      )
      pool.markKeySuccess(currentApiKey)
      return results
    } catch (e) {
      if (options.signal?.aborted || isAbortError(e)) throw e
      pool.markKeyError(currentApiKey)
      throw e
    }
  }
  const provider = runtimeConfig.public.webSearchProvider as ConfigWebSearchProvider
  let readSource: WebSearchFunction['readSource']
  if (provider === 'firecrawl') {
    readSource = createReadSource({
      provider,
      apiKey: runtimeConfig.webSearchApiKey,
      apiBase: runtimeConfig.webSearchApiBase,
    })
  } else if (provider === 'tavily') {
    readSource = async (url, options) => {
      const pool = getOrCreateApiKeyPool(
        apiKeyPool,
        (next) => {
          apiKeyPool = next
        },
        'tavily',
        runtimeConfig,
      )
      const selected = pool.getNextKey()
      if (!selected) return undefined
      try {
        const result = await createReadSource({ provider, apiKey: selected.key })!(url, options)
        if (result) pool.markKeySuccess(selected.key)
        return result
      } catch (error) {
        if (options.signal?.aborted || isAbortError(error)) throw error
        // Page-level failures must not disable an otherwise valid API key.
        const status = (error as { response?: { status?: number } })?.response?.status
        if (status === 401 || status === 403) pool.markKeyError(selected.key)
        throw error
      }
    }
  }
  return Object.assign(search, { readSource })
}
