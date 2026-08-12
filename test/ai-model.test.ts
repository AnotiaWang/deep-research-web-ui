import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getApiBase, isAiApiKeyRequired } from '../shared/utils/ai-model.ts'

describe('getApiBase', () => {
  it('returns the default Requesty router URL', () => {
    assert.equal(
      getApiBase({
        provider: 'requesty',
        model: 'openai/gpt-4o',
      }),
      'https://router.requesty.ai/v1',
    )
  })

  it('returns the default LiteLLM proxy URL', () => {
    assert.equal(
      getApiBase({
        provider: 'litellm',
        model: 'gpt-4o',
      }),
      'http://localhost:4000/v1',
    )
  })

  it('allows a custom LiteLLM API base', () => {
    assert.equal(
      getApiBase({
        provider: 'litellm',
        model: 'gpt-4o',
        apiBase: 'https://litellm.example.com/v1',
      }),
      'https://litellm.example.com/v1',
    )
  })
})

describe('isAiApiKeyRequired', () => {
  it('allows unauthenticated local providers', () => {
    assert.equal(isAiApiKeyRequired('litellm'), false)
    assert.equal(isAiApiKeyRequired('ollama'), false)
  })

  it('keeps API keys required for hosted providers', () => {
    assert.equal(isAiApiKeyRequired('openai-compatible'), true)
    assert.equal(isAiApiKeyRequired('openrouter'), true)
    assert.equal(isAiApiKeyRequired('requesty'), true)
    assert.equal(isAiApiKeyRequired('deepseek'), true)
  })
})
