import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { z } from 'zod'
import type { TextStreamPart } from 'ai'
import { parseStreamingJson } from '../shared/utils/json.ts'

async function* streamText(parts: string[]): AsyncGenerator<TextStreamPart<any>> {
  for (const text of parts) {
    yield { type: 'text-delta', textDelta: text } as TextStreamPart<any>
  }
}

describe('parseStreamingJson', () => {
  const schema = z.object({
    questions: z.array(z.string()),
  })

  it('accepts an explicit empty questions array as valid', async () => {
    const events = []
    for await (const event of parseStreamingJson(
      streamText(['{"questions":[]}']),
      schema,
      (value) => Array.isArray(value.questions) && value.questions.length === 0,
    )) {
      events.push(event)
    }

    assert.deepEqual(events, [{ type: 'object', value: { questions: [] } }])
  })

  it('returns bad-end when JSON parses but never satisfies isValid', async () => {
    const events = []
    for await (const event of parseStreamingJson(streamText(['{}']), schema, (value) =>
      Array.isArray(value.questions),
    )) {
      events.push(event)
    }

    assert.equal(events.length, 1)
    assert.equal(events[0]?.type, 'bad-end')
  })

  it('returns bad-end for invalid JSON', async () => {
    const events = []
    for await (const event of parseStreamingJson(streamText(['not-json']), schema, (value) =>
      Array.isArray(value.questions),
    )) {
      events.push(event)
    }

    assert.equal(events[0]?.type, 'bad-end')
  })
})
