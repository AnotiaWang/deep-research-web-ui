import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  hasMeaningfulFeedbackQuestions,
  mergeFeedbackQuestions,
} from '../app/utils/feedback.ts'

describe('feedback question merging', () => {
  it('does not render empty streamed placeholders as questions', () => {
    assert.deepEqual(mergeFeedbackQuestions([], ['', '  ', undefined, 'First question']), [
      { assistantQuestion: 'First question', userAnswer: '' },
    ])
  })

  it('preserves answers while streamed questions are updated', () => {
    assert.deepEqual(
      mergeFeedbackQuestions(
        [{ assistantQuestion: 'First question', userAnswer: 'First answer' }],
        ['First question', 'Second question'],
      ),
      [
        { assistantQuestion: 'First question', userAnswer: 'First answer' },
        { assistantQuestion: 'Second question', userAnswer: '' },
      ],
    )
  })

  it('keeps the previous list when the streamed value is not an array', () => {
    const previous = [{ assistantQuestion: 'First question', userAnswer: '' }]
    assert.deepEqual(mergeFeedbackQuestions(previous, { question: 'invalid' }), previous)
  })

  it('keeps the last usable questions when the stream ends with empty placeholders', () => {
    const previous = [
      { assistantQuestion: 'Which AI news topics matter most?', userAnswer: 'Models' },
    ]

    assert.deepEqual(mergeFeedbackQuestions(previous, []), previous)
    assert.deepEqual(mergeFeedbackQuestions(previous, ['', '  ', undefined]), previous)
  })

  it('treats empty-string skeletons as having no meaningful questions', () => {
    assert.equal(hasMeaningfulFeedbackQuestions(['', '  ', null]), false)
    assert.equal(hasMeaningfulFeedbackQuestions(['', 'Real question']), true)
    assert.equal(
      hasMeaningfulFeedbackQuestions([{ assistantQuestion: 'Real question', userAnswer: '' }]),
      true,
    )
    assert.equal(hasMeaningfulFeedbackQuestions({ questions: ['x'] }), false)
  })

  it('tolerates a non-array previous value when merging', () => {
    assert.deepEqual(
      mergeFeedbackQuestions(undefined as any, ['Only question']),
      [{ assistantQuestion: 'Only question', userAnswer: '' }],
    )
  })
})
