import { createDeepSeek } from '@ai-sdk/deepseek'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { wrapLanguageModel, extractReasoningMiddleware } from 'ai'
import type { LanguageModelV1 } from 'ai'

export function getLanguageModel(config: ConfigAi) {
  const apiBase = getApiBase(config)
  let model: LanguageModelV1

  if (config.provider === 'openrouter') {
    const openRouter = createOpenRouter({
      apiKey: config.apiKey,
      baseURL: apiBase,
    })
    model = openRouter(config.model, {
      includeReasoning: true,
    })
  } else if (
    config.provider === 'deepseek' ||
    config.provider === 'siliconflow' ||
    config.provider === 'infiniai' ||
    // Special case if model name includes 'deepseek'
    // This ensures compatibilty with providers like Siliconflow
    config.model?.toLowerCase().includes('deepseek')
  ) {
    const deepSeek = createDeepSeek({
      apiKey: config.apiKey,
      baseURL: apiBase,
    })
    model = deepSeek(config.model)
  } else {
    const openai = createOpenAI({
      apiKey: config.apiKey,
      baseURL: apiBase,
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
  if (config.provider === 'deepseek') {
    return config.apiBase || 'https://api.deepseek.com/v1'
  }
  if (config.provider === 'ollama') {
    return config.apiBase || 'http://localhost:11434/v1'
  }
  if (config.provider === 'siliconflow') {
    return config.apiBase || 'https://api.siliconflow.cn/v1'
  }
  if (config.provider === 'infiniai') {
    return config.apiBase || 'https://cloud.infini-ai.com/maas/v1'
  }
  if (config.provider === '302-ai') {
    return config.apiBase || 'https://api.302.ai/v1'
  }
  if (config.provider === 'litellm') {
    return config.apiBase || 'http://localhost:4000/v1'
  }
  return config.apiBase || 'https://api.openai.com/v1'
}
