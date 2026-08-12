import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  escapePromptAttribute,
  finalizeLearningsFromSearchResults,
} from '../shared/utils/search-learning.ts'

describe('finalizeLearningsFromSearchResults', () => {
  const results = [
    { url: 'https://example.com/a', title: 'A' },
    { url: 'https://example.com/b', title: 'B' },
  ]

  it('keeps only learnings whose URL is in the search results', () => {
    assert.deepEqual(
      finalizeLearningsFromSearchResults(
        [
          { url: 'https://example.com/a', learning: ' Fact A ' },
          { url: 'https://hallucinated.example/x', learning: 'Fake' },
          { url: 'https://example.com/b', learning: 'Fact B' },
          { url: 'https://example.com/a', learning: '   ' },
        ],
        results,
      ),
      [
        { url: 'https://example.com/a', learning: 'Fact A', title: 'A' },
        { url: 'https://example.com/b', learning: 'Fact B', title: 'B' },
      ],
    )
  })

  it('returns an empty list when learnings are missing', () => {
    assert.deepEqual(finalizeLearningsFromSearchResults(undefined, results), [])
  })
})

describe('escapePromptAttribute', () => {
  it('escapes quotes and ampersands for prompt attributes', () => {
    assert.equal(
      escapePromptAttribute('https://example.com/q?a=1&b="x"'),
      'https://example.com/q?a=1&amp;b=&quot;x&quot;',
    )
  })
})
