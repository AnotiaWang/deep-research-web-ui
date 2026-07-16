import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  feedbackRequestSchema,
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
})
