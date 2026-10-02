import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  estimateMaxSearches,
  feedbackRequestSchema,
  findResearchPreset,
  researchPresets,
  researchInputSchema,
  researchRequestSchema,
} from '../shared/utils/research-input.ts'

const validInput = {
  query: 'test query',
  numQuestions: 3,
  depth: 2,
  breadth: 2,
}

describe('research input validation', () => {
  it('accepts valid boundaries and trims the query', () => {
    const minimum = researchInputSchema.parse({
      query: '  topic  ',
      numQuestions: 1,
      depth: 1,
      breadth: 1,
    })
    const maximum = researchInputSchema.parse({
      query: 'topic',
      numQuestions: 5,
      depth: 8,
      breadth: 8,
    })

    assert.equal(minimum.query, 'topic')
    assert.equal(maximum.depth, 8)
  })

  it('coerces numeric form values', () => {
    const result = researchInputSchema.parse({
      ...validInput,
      numQuestions: '3',
      depth: '2',
      breadth: '4',
    })

    assert.deepEqual(result, { ...validInput, breadth: 4 })
  })

  for (const value of [-1, 0, 999, 1.5]) {
    it(`rejects an invalid depth of ${value}`, () => {
      assert.equal(researchInputSchema.safeParse({ ...validInput, depth: value }).success, false)
    })
  }

  it('rejects empty queries and out-of-range question or breadth values', () => {
    assert.equal(researchInputSchema.safeParse({ ...validInput, query: '   ' }).success, false)
    assert.equal(researchInputSchema.safeParse({ ...validInput, numQuestions: 6 }).success, false)
    assert.equal(researchInputSchema.safeParse({ ...validInput, breadth: 9 }).success, false)
  })

  it('does not coerce booleans or empty strings into valid numbers', () => {
    assert.equal(researchInputSchema.safeParse({ ...validInput, depth: true }).success, false)
    assert.equal(researchInputSchema.safeParse({ ...validInput, depth: '' }).success, false)
  })

  it('applies the same limits to feedback and research API requests', () => {
    assert.equal(
      feedbackRequestSchema.safeParse({ query: 'topic', language: 'English', numQuestions: 0 })
        .success,
      false,
    )
    assert.equal(
      researchRequestSchema.safeParse({
        query: 'topic',
        breadth: -1,
        depth: 2,
        languageCode: 'en',
      }).success,
      false,
    )
  })

  it('normalizes region-qualified locales (e.g. en-US) to their base language', () => {
    const parsed = researchRequestSchema.safeParse({
      query: 'topic',
      breadth: 2,
      depth: 2,
      languageCode: 'en-US',
      searchLanguageCode: 'zh_CN',
    })
    assert.equal(parsed.success, true)
    if (parsed.success) {
      assert.equal(parsed.data.languageCode, 'en')
      assert.equal(parsed.data.searchLanguageCode, 'zh')
    }

    const korean = researchRequestSchema.safeParse({
      query: 'topic',
      breadth: 2,
      depth: 2,
      languageCode: 'ko-KR',
      searchLanguageCode: 'ko',
    })
    assert.equal(korean.success, true)
    if (korean.success) {
      assert.equal(korean.data.languageCode, 'ko')
      assert.equal(korean.data.searchLanguageCode, 'ko')
    }
  })

  it('rejects locales that do not map to a supported language', () => {
    assert.equal(
      researchRequestSchema.safeParse({
        query: 'topic',
        breadth: 2,
        depth: 2,
        languageCode: 'fr-FR',
      }).success,
      false,
    )
  })

  it('accepts optional originalQuery for narrowed retries', () => {
    const parsed = researchRequestSchema.safeParse({
      query: 'narrowed follow-up',
      originalQuery: 'Initial Query: full topic',
      breadth: 2,
      depth: 2,
      languageCode: 'zh',
      searchLanguageCode: 'en',
    })
    assert.equal(parsed.success, true)
    if (parsed.success) {
      assert.equal(parsed.data.originalQuery, 'Initial Query: full topic')
    }
  })
})

describe('research presets', () => {
  it('estimates the planned search upper bound with halving breadth', () => {
    assert.equal(estimateMaxSearches(2, 1), 2)
    assert.equal(estimateMaxSearches(2, 2), 4)
    assert.equal(estimateMaxSearches(4, 3), 20)
    assert.equal(estimateMaxSearches(8, 8), 424)
  })

  it('matches presets by breadth and depth, including string input', () => {
    assert.equal(findResearchPreset(researchPresets.deep), 'deep')
    assert.equal(findResearchPreset({ breadth: '2', depth: '2' }), 'standard')
    assert.equal(findResearchPreset({ breadth: 3, depth: 2 }), undefined)
  })

  it('only defines presets within input limits', () => {
    for (const preset of Object.values(researchPresets)) {
      assert.equal(researchInputSchema.safeParse({ ...validInput, ...preset }).success, true)
    }
  })
})
