import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  feedbackSystemPrompt,
  languagePrompt,
  learningExtractorSystemPrompt,
  reportSystemPrompt,
  resolveResponseLanguage,
  searchPlannerSystemPrompt,
} from '../lib/prompt.ts'
import { getCombinedQuery } from '../app/utils/prompt.ts'

describe('resolveResponseLanguage', () => {
  it('maps locale codes and display names to stable language names', () => {
    assert.equal(resolveResponseLanguage('zh'), '中文')
    assert.equal(resolveResponseLanguage('en'), 'English')
    assert.equal(resolveResponseLanguage('nl'), 'Nederlands')
    assert.equal(resolveResponseLanguage('中文'), '中文')
    assert.equal(resolveResponseLanguage('English'), 'English')
  })
})

describe('languagePrompt', () => {
  it('uses natural language names for locale codes', () => {
    assert.match(languagePrompt('zh'), /^Respond in 中文\./)
    assert.match(languagePrompt('en'), /^Respond in English\./)
  })

  it('adds CJK spacing guidance for Chinese locales and names', () => {
    assert.match(languagePrompt('zh'), /中文和英文之间添加适当的空格/)
    assert.match(languagePrompt('中文'), /中文和英文之间添加适当的空格/)
    assert.equal(languagePrompt('en').includes('中文和英文'), false)
  })
})

describe('task-specific system prompts', () => {
  it('keeps extraction and reporting grounded, not speculative', () => {
    assert.match(learningExtractorSystemPrompt(), /Never invent URLs/)
    assert.match(reportSystemPrompt(), /Do not speculate beyond the learnings/)
    assert.equal(learningExtractorSystemPrompt().includes('source is irrelevant'), false)
    assert.equal(reportSystemPrompt().includes('high levels of speculation'), false)
  })

  it('asks feedback to allow an empty question list when the query is clear', () => {
    assert.match(feedbackSystemPrompt(), /return an empty questions list/)
  })

  it('steers search planning toward specific retrievable queries', () => {
    assert.match(searchPlannerSystemPrompt(), /specificity/)
  })

})

describe('getCombinedQuery', () => {
  it('omits the Q&A section when there is no answered feedback', () => {
    assert.equal(
      getCombinedQuery({ query: 'AI agents', numQuestions: 3, depth: 2, breadth: 3 }, []),
      'Initial Query: AI agents',
    )
    assert.equal(
      getCombinedQuery({ query: 'AI agents', numQuestions: 3, depth: 2, breadth: 3 }, [
        { assistantQuestion: 'Scope?', userAnswer: '' },
      ]),
      'Initial Query: AI agents',
    )
  })

  it('includes only answered follow-ups', () => {
    assert.equal(
      getCombinedQuery({ query: 'AI agents', numQuestions: 3, depth: 2, breadth: 3 }, [
        { assistantQuestion: 'Scope?', userAnswer: 'Enterprise' },
        { assistantQuestion: 'Time range?', userAnswer: '' },
      ]),
      `Initial Query: AI agents
Follow-up Questions and Answers:
Q: Scope?
A: Enterprise`,
    )
  })
})
