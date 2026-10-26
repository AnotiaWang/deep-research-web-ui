import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getStreamErrorMessage } from '../shared/utils/stream-error.ts'

/** Shaped like the AI SDK's APICallError, which carries the key and gateway URL. */
function upstreamError(message: string, statusCode = 401) {
  return Object.assign(new Error(message), {
    url: 'http://gateway.internal/v1/chat/completions',
    statusCode,
    responseBody: JSON.stringify({ error: { message } }),
  })
}

describe('stream error messages', () => {
  it('reads client and server error payloads', () => {
    assert.equal(getStreamErrorMessage({ error: new Error('client failed') }), 'client failed')
    assert.equal(getStreamErrorMessage({ error: 'server failed' }), 'server failed')
    assert.equal(getStreamErrorMessage({ message: 'legacy server failed' }), 'legacy server failed')
    assert.equal(
      getStreamErrorMessage({ error: { message: 'serialized failed' } }),
      'serialized failed',
    )
  })

  it('replaces upstream API errors with their status instead of forwarding the body', () => {
    // Providers echo the rejected credential, and the gateway URL is internal.
    const error = upstreamError('Incorrect API key provided: Bearer sk-live-SECRET-9f3a')
    assert.equal(
      getStreamErrorMessage({ error }),
      'The AI provider rejected the request (HTTP 401).',
    )
    assert.equal(
      getStreamErrorMessage({ error: upstreamError('boom', 503) }),
      'The AI provider rejected the request (HTTP 503).',
    )
  })

  it('keeps messages this project writes itself', () => {
    const truncated = 'Model output was truncated at the output token limit before valid JSON'
    assert.equal(getStreamErrorMessage({ error: new Error(truncated) }), truncated)
  })

  it('scrubs secrets that survive in ordinary text', () => {
    assert.ok(!getStreamErrorMessage({ error: 'token sk-abcdefghijklmnop leaked' }).includes('sk-'))
  })
})
