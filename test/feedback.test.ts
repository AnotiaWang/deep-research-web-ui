import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  hasMeaningfulFeedbackQuestions,
  mergeFeedbackQuestions,
} from '../app/utils/feedback.ts'
import { generateFeedback } from '../lib/core/feedback.ts'

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

function mockAiConfig(output: unknown, prompts: string[]) {
  const chunk = (delta: object, finishReason: string | null = null) =>
    `data: ${JSON.stringify({
      id: 'feedback',
      object: 'chat.completion.chunk',
      created: 0,
      model: 'test-model',
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    })}\n\n`
  return {
    provider: 'openai-compatible' as const,
    apiKey: 'test',
    apiBase: 'https://llm.example.com/v1',
    model: 'test-model',
    fetch: async (_input: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      prompts.push(body.messages.map((message: any) => message.content).join('\n'))
      return new Response(
        chunk({ role: 'assistant', content: JSON.stringify(output) }) +
          chunk({}, 'stop') +
          'data: [DONE]\n\n',
        { headers: { 'Content-Type': 'text/event-stream' } },
      )
    },
  }
}

async function collectFeedback(
  options: Partial<Parameters<typeof generateFeedback>[0]>,
  output: unknown,
) {
  const prompts: string[] = []
  const chunks = []
  for await (const chunk of generateFeedback({
    query: 'Compare EV battery chemistries',
    language: 'en',
    aiConfig: mockAiConfig(output, prompts),
    ...options,
  })) {
    chunks.push(chunk)
  }
  return { prompt: prompts.join('\n'), last: chunks.at(-1) }
}

describe('feedback research mode suggestion', () => {
  it('asks for a research mode with search estimates only when requested', async () => {
    const plain = await collectFeedback({}, { questions: [] })
    assert.doesNotMatch(plain.prompt, /researchMode/)

    const suggested = await collectFeedback(
      { suggestResearchMode: true },
      { questions: [], researchMode: 'deep', researchModeReason: 'Many chemistries to compare.' },
    )
    assert.match(suggested.prompt, /"quick" \(up to 2 searches\)/)
    assert.match(suggested.prompt, /"deep" \(up to 20 searches\)/)
    assert.deepEqual(suggested.last, {
      type: 'object',
      value: {
        questions: [],
        researchMode: 'deep',
        researchModeReason: 'Many chemistries to compare.',
      },
    })
  })
})
