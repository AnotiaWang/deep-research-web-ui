import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { normalizeGeneratedSearchQueries } from '../shared/utils/search-query.ts'

describe('generated search query normalization', () => {
  it('excludes incomplete streamed queries while retaining their original node indexes', () => {
    assert.deepEqual(
      normalizeGeneratedSearchQueries(
        [
          { query: '  ', researchGoal: '' },
          { query: 'First completed query', researchGoal: 'First goal' },
          { query: 'undefined', researchGoal: '' },
          { query: ' Second completed query ', researchGoal: 'Second goal' },
        ],
        '0-1',
      ),
      [
        {
          query: 'First completed query',
          researchGoal: 'First goal',
          nodeId: '0-1-1',
        },
        {
          query: 'Second completed query',
          researchGoal: 'Second goal',
          nodeId: '0-1-3',
        },
      ],
    )
  })
})
