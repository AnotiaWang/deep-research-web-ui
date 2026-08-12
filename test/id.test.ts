import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createRuntimeId } from '../shared/utils/id.ts'

describe('runtime IDs', () => {
  it('uses randomUUID when it is available', () => {
    assert.equal(createRuntimeId({ randomUUID: () => 'secure-uuid' }), 'secure-uuid')
  })

  it('creates unique IDs without secure-context crypto APIs', () => {
    const first = createRuntimeId(
      null,
      () => 123,
      () => 0.5,
    )
    const second = createRuntimeId(
      null,
      () => 123,
      () => 0.5,
    )

    assert.notEqual(first, second)
    assert.match(first, /^[a-z0-9-]+$/)
  })
})
