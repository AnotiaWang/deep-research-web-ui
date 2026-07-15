import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mergeFeedbackQuestions } from '../app/utils/feedback.ts'

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
})
