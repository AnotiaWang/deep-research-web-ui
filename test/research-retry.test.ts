import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveResearchRetryQuery } from '../app/utils/research-retry.ts'

describe('research retry query', () => {
  it('keeps the original combined query when retrying the root node', () => {
    assert.equal(
      resolveResearchRetryQuery('Initial Query: original topic', { id: '0', label: 'Start' }),
      'Initial Query: original topic',
    )
  })

  it('uses the node query when retrying a non-root node', () => {
    assert.equal(
      resolveResearchRetryQuery('Initial Query: original topic', {
        id: '0-1',
        label: 'specific follow-up',
      }),
      'specific follow-up',
    )
  })
})
