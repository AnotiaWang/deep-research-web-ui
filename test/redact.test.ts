import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { redactSecrets, toClientErrorMessage } from '../shared/utils/redact.ts'

describe('secret redaction', () => {
  it('scrubs credentials a provider echoes back', () => {
    const message =
      'Incorrect API key provided: Bearer sk-live-9f3a2b1c. Check https://gw.internal/org/acct_8842'
    const redacted = redactSecrets(message)
    assert.ok(!redacted.includes('sk-live-9f3a2b1c'), redacted)
    assert.ok(redacted.includes('https://gw.internal'), 'the gateway URL itself is not a secret')
  })

  it('scrubs keys carried in query strings', () => {
    for (const url of [
      'https://www.googleapis.com/customsearch/v1?key=AIzaSyD-1234567890&cx=abc',
      'https://ydc-index.io/v1/search?query=x&api_key=ydc_live_123456',
      'https://api.example/v1?access_token=tok_live_abcdef',
    ]) {
      assert.ok(!redactSecrets(url).match(/AIzaSyD-|ydc_live_|tok_live_/), url)
    }
  })

  it('scrubs header dumps', () => {
    assert.ok(!redactSecrets('x-api-key: sk-secret-value-1234').includes('sk-secret-value-1234'))
    assert.ok(!redactSecrets('{"x-goog-api-key":"AIzaSyABCDEFGH"}').includes('AIzaSyABCDEFGH'))
  })

  it('leaves ordinary text alone', () => {
    const text = 'The model returned invalid JSON after 3 attempts.'
    assert.equal(redactSecrets(text), text)
  })

  it('truncates long text so an upstream body cannot be reflected wholesale', () => {
    const truncated = toClientErrorMessage('x'.repeat(5_000))
    assert.ok(truncated.length <= 501, `length ${truncated.length}`)
    assert.ok(truncated.endsWith('…'))
  })
})
