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
import { researchRequestSchema } from '~~/shared/utils/research-input'
import { getServerProxyFetch, proxyEnvFromRuntimeConfig } from '~~/server/utils/proxy'
import { createParallelWebSearch } from '~~/server/utils/parallel-search'
import { getApiKeyPool } from '~~/server/utils/api-key-pool'

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
    maxOutputTokens: runtimeConfig.public.aiMaxOutputTokens || undefined,
    fetch: getServerProxyFetch(proxyEnvFromRuntimeConfig(runtimeConfig)),
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
        await serverWebSearch.close?.()
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

export function createServerWebSearch(runtimeConfig: RuntimeConfig): WebSearchFunction {
  const proxyFetch = getServerProxyFetch(proxyEnvFromRuntimeConfig(runtimeConfig))
  if (runtimeConfig.public.webSearchProvider === 'parallel') {
    return createParallelWebSearch({ fetch: proxyFetch })
  }
  const provider = runtimeConfig.public.webSearchProvider as ConfigWebSearchProvider
  const search: WebSearchFunction = async (query: string, options: WebSearchOptions) => {
    const sharedConfig = {
      provider,
      apiBase: runtimeConfig.webSearchApiBase,
      googlePseId: runtimeConfig.public.googlePseId,
      tavilyAdvancedSearch: runtimeConfig.public.tavilyAdvancedSearch,
      tavilySearchTopic: runtimeConfig.public.tavilySearchTopic as
        'general' | 'news' | 'finance' | undefined,
      fetch: proxyFetch,
    }

    if (provider === 'firecrawl' || provider === 'crw') {
      return searchWeb({ ...sharedConfig, apiKey: runtimeConfig.webSearchApiKey }, query, options)
    }
    if (provider === 'google-pse' && !runtimeConfig.public.googlePseId) {
      throw new Error('NUXT_PUBLIC_GOOGLE_PSE_ID environment variable not set.')
    }
    // You.com works keyless; when keys are configured, rotate them like
    // the other keyed providers (comma-separated NUXT_WEB_SEARCH_API_KEY).
    if (provider === 'youcom' && !runtimeConfig.webSearchApiKey?.trim()) {
      return searchWeb({ ...sharedConfig, apiKey: undefined }, query, options)
    }

    const pooled = Object.hasOwn(pooledProviders, provider)
      ? (provider as keyof typeof pooledProviders)
      : 'tavily'
    return getApiKeyPool(pooled, runtimeConfig.webSearchApiKey).withKey(
      (apiKey) => searchWeb({ ...sharedConfig, provider: pooled, apiKey }, query, options),
      { label: pooledProviders[pooled], signal: options.signal },
    )
  }

  let readSource: WebSearchFunction['readSource']
  if (provider === 'firecrawl') {
    readSource = createReadSource({
      provider,
      apiKey: runtimeConfig.webSearchApiKey,
      apiBase: runtimeConfig.webSearchApiBase,
    })
  } else if (provider === 'tavily') {
    readSource = (url, options) =>
      getApiKeyPool('tavily', runtimeConfig.webSearchApiKey).withKey(
        (apiKey) => createReadSource({ provider, apiKey })!(url, options),
        {
          label: 'Tavily',
          signal: options.signal,
          // Page-level failures must not disable an otherwise valid API key.
          isKeyError: (error) => {
            const status = (error as { response?: { status?: number } })?.response?.status
            return status === 401 || status === 403
          },
        },
      )
  }
  return Object.assign(search, { readSource })
}

/** Providers whose comma-separated keys rotate through an API key pool. */
const pooledProviders = {
  tavily: 'Tavily',
  'google-pse': 'Google PSE',
  youcom: 'You.com',
  serply: 'Serply',
  looot: 'looot',
} as const
