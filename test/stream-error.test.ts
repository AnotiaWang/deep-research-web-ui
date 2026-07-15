import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getStreamErrorMessage } from '../shared/utils/stream-error.ts'

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
})
