import assert from 'node:assert'
import { describe, it } from 'node:test'
import type { ConfigAiProvider } from './config'

describe('ConfigAiProvider type', () => {
  it('litellm is a valid provider value', () => {
    const provider: ConfigAiProvider = 'litellm'
    assert.strictEqual(provider, 'litellm')
  })

  it('all expected providers are valid', () => {
    const providers: ConfigAiProvider[] = [
      'openai-compatible',
      'siliconflow',
      '302-ai',
      'infiniai',
      'openrouter',
      'deepseek',
      'ollama',
      'litellm',
    ]
    assert.strictEqual(providers.length, 8)
    assert.ok(providers.includes('litellm'))
  })
})
