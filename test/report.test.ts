import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { MockLanguageModelV1, convertArrayToReadableStream } from 'ai/test'
import { countTokens } from '../lib/ai/providers.ts'
import { writeFinalReport } from '../lib/core/report.ts'

const globals = globalThis as any
const originalModel = globals.getLanguageModel

afterEach(() => {
  globals.getLanguageModel = originalModel
})

async function capturePrompt(params: Parameters<typeof writeFinalReport>[0]) {
  let request: any
  globals.getLanguageModel = () =>
    new MockLanguageModelV1({
      doStream: async (options) => {
        request = options
        return {
          rawCall: { rawPrompt: '', rawSettings: {} },
          stream: convertArrayToReadableStream([
            {
              type: 'finish',
              finishReason: 'stop',
              usage: { promptTokens: 1, completionTokens: 1 },
            },
          ]),
        }
      },
    })
  await writeFinalReport(params).consumeStream()
  const text = (role: string) =>
    request.prompt
      .filter((message: any) => message.role === role)
      .map((message: any) =>
        typeof message.content === 'string'
          ? message.content
          : message.content.map((part: any) => part.text).join(''),
      )
      .join('\n')
  return { system: text('system'), prompt: text('user'), maxTokens: request.maxTokens }
}

const learnings = Array.from({ length: 60 }, (_, index) => ({
  url: `https://example.com/${index + 1}`,
  learning: `Finding ${index + 1}: ${'detailed evidence '.repeat(150)}`,
}))
const aiConfig = { provider: 'openai-compatible' as const, model: 'test', contextSize: 16_000 }

describe('writeFinalReport context budget', () => {
  it('fits learnings, instructions and the output reserve into the context', async () => {
    const { system, prompt, maxTokens } = await capturePrompt({
      prompt: 'Research goal',
      learnings,
      language: 'English',
      aiConfig,
    })
    assert.equal(maxTokens, undefined)
    assert.match(prompt, /<learning index="1"/)
    assert.doesNotMatch(prompt, /<learning index="60"/)
    // 4k output reserve and a 10% tokenizer margin
    assert.ok(countTokens(system) + countTokens(prompt) <= 16_000 - 4_000)
  })

  it('keeps new and block-cited evidence when revision evidence must be trimmed', async () => {
    const { system, prompt, maxTokens } = await capturePrompt({
      prompt: 'Research goal',
      learnings,
      language: 'English',
      aiConfig: { ...aiConfig, maxOutputTokens: 2_000 },
      revision: {
        instruction: 'Check the claim',
        targetLearning: learnings[39]!.learning,
        firstNewCitation: 59,
        blocks: [{ id: 0, markdown: 'A claim [40].' }],
      },
    })
    assert.equal(maxTokens, 2_000)
    const citations = [...prompt.matchAll(/"citation":(\d+)/g)].map((match) => Number(match[1]))
    assert.ok(citations.includes(40) && citations.includes(59) && citations.includes(60))
    assert.ok(citations.includes(1))
    assert.ok(citations.length < learnings.length)
    assert.ok(countTokens(system) + countTokens(prompt) <= 16_000 - 2_000)
  })

  it('fails clearly when required revision evidence cannot fit', () => {
    assert.throws(
      () =>
        writeFinalReport({
          prompt: 'Research goal',
          learnings,
          language: 'English',
          aiConfig: { ...aiConfig, contextSize: 4_000 },
          revision: {
            instruction: 'Check the claim',
            targetLearning: learnings[0]!.learning,
            firstNewCitation: 2,
            blocks: [{ id: 0, markdown: 'A claim [1].' }],
          },
        }),
      /context budget/,
    )
  })
})
