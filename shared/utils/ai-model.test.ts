import assert from 'node:assert'
import { describe, it } from 'node:test'
import { getApiBase } from './ai-model'

describe('getApiBase', () => {
  it('returns default LiteLLM proxy URL for litellm provider', () => {
    const result = getApiBase({
      provider: 'litellm',
      model: 'gpt-4o',
    })
    assert.strictEqual(result, 'http://localhost:4000/v1')
  })

  it('allows custom api_base override for litellm', () => {
    const result = getApiBase({
      provider: 'litellm',
      model: 'gpt-4o',
      apiBase: 'https://litellm.example.com/v1',
    })
    assert.strictEqual(result, 'https://litellm.example.com/v1')
  })

  it('returns default OpenAI URL for openai-compatible provider', () => {
    const result = getApiBase({
      provider: 'openai-compatible',
      model: 'gpt-4o',
    })
    assert.strictEqual(result, 'https://api.openai.com/v1')
  })

  it('returns default Ollama URL for ollama provider', () => {
    const result = getApiBase({
      provider: 'ollama',
      model: 'llama3',
    })
    assert.strictEqual(result, 'http://localhost:11434/v1')
  })

  it('returns default DeepSeek URL for deepseek provider', () => {
    const result = getApiBase({
      provider: 'deepseek',
      model: 'deepseek-chat',
    })
    assert.strictEqual(result, 'https://api.deepseek.com/v1')
  })

  it('returns default OpenRouter URL for openrouter provider', () => {
    const result = getApiBase({
      provider: 'openrouter',
      model: 'openai/gpt-4o',
    })
    assert.strictEqual(result, 'https://openrouter.ai/api/v1')
  })

  it('custom apiBase overrides default for any provider', () => {
    const custom = 'https://custom-proxy.internal/v1'
    for (const provider of ['openai-compatible', 'litellm', 'deepseek', 'ollama'] as const) {
      const result = getApiBase({
        provider,
        model: 'test-model',
        apiBase: custom,
      })
      assert.strictEqual(result, custom, `apiBase override failed for ${provider}`)
    }
  })
})
