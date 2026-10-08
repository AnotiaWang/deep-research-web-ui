import { createDeepSeek } from '@ai-sdk/deepseek'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { wrapLanguageModel, extractReasoningMiddleware } from 'ai'
import type { LanguageModelV1 } from 'ai'
import type { ConfigAi, ConfigAiProvider } from '../types/config'

// Record keyed by the union so adding a provider without listing it here fails typecheck
const AI_PROVIDERS: Record<ConfigAiProvider, true> = {
  'openai-compatible': true,
  siliconflow: true,
  '302-ai': true,
  openrouter: true,
  requesty: true,
  deepseek: true,
  ollama: true,
  litellm: true,
}

export function isSupportedAiProvider(provider: string): provider is ConfigAiProvider {
  return Object.hasOwn(AI_PROVIDERS, provider)
}

/**
 * Returns an error message if `provider` can't be used, or `undefined` if it's supported.
 */
export function getAiProviderError(provider: string): string | undefined {
  if (isSupportedAiProvider(provider)) return undefined
  if (provider === 'infiniai') {
    return (
      'AI provider "infiniai" is no longer supported. ' +
      'Use "openai-compatible" with API base https://cloud.infini-ai.com/maas/v1 instead.'
    )
  }
  return `Unknown AI provider "${provider}". Supported: ${Object.keys(AI_PROVIDERS).join(', ')}.`
}

export function isAiApiKeyRequired(provider: ConfigAiProvider) {
  return provider !== 'ollama' && provider !== 'litellm'
}

export const DEFAULT_AI_CONTEXT_SIZE = 256_000

/** The configured output cap, or `undefined` so the request omits `max_tokens`. */
export function getMaxOutputTokens(config: ConfigAi) {
  // Form inputs may store numbers as strings
  const value = Number(config.maxOutputTokens)
  return Number.isInteger(value) && value > 0 ? value : undefined
}

export function getLanguageModel(config: ConfigAi) {
  const apiBase = getApiBase(config)
  let model: LanguageModelV1

  if (config.provider === 'openrouter') {
    const openRouter = createOpenRouter({
      apiKey: config.apiKey,
      baseURL: apiBase,
      fetch: config.fetch,
    })
    model = openRouter(config.model, {
      includeReasoning: true,
    })
  } else if (
    config.provider === 'deepseek' ||
    config.provider === 'siliconflow' ||
    // Special case if model name includes 'deepseek'
    // This ensures compatibilty with providers like Siliconflow
    config.model?.toLowerCase().includes('deepseek')
  ) {
    const deepSeek = createDeepSeek({
      apiKey: config.apiKey,
      baseURL: apiBase,
      fetch: config.fetch,
    })
    model = deepSeek(config.model)
  } else {
    const openai = createOpenAI({
      apiKey: config.apiKey,
      baseURL: apiBase,
      fetch: config.fetch,
    })
    model = openai(config.model)
  }

  return wrapLanguageModel({
    model,
    middleware: extractReasoningMiddleware({ tagName: 'think' }),
  })
}

export function getApiBase(config: ConfigAi) {
  if (config.provider === 'openrouter') {
    return config.apiBase || 'https://openrouter.ai/api/v1'
  }
  if (config.provider === 'requesty') {
    return config.apiBase || 'https://router.requesty.ai/v1'
  }
  if (config.provider === 'deepseek') {
    return config.apiBase || 'https://api.deepseek.com/v1'
  }
  if (config.provider === 'ollama') {
    return config.apiBase || 'http://localhost:11434/v1'
  }
  if (config.provider === 'siliconflow') {
    return config.apiBase || 'https://api.siliconflow.cn/v1'
  }
  if (config.provider === '302-ai') {
    return config.apiBase || 'https://api.302.ai/v1'
  }
  if (config.provider === 'litellm') {
    return config.apiBase || 'http://localhost:4000/v1'
  }
  return config.apiBase || 'https://api.openai.com/v1'
}
