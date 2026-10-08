import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { z } from 'zod'
import type { TextStreamPart } from 'ai'
import { parseStreamingJson, structuredOutputError } from '../shared/utils/json.ts'

async function* streamText(parts: string[]): AsyncGenerator<TextStreamPart<any>> {
  for (const text of parts) {
    yield { type: 'text-delta', textDelta: text } as TextStreamPart<any>
  }
}

async function* finishedStream(
  parts: TextStreamPart<any>[],
  finishReason: string,
): AsyncGenerator<TextStreamPart<any>> {
  yield* parts
  yield { type: 'finish', finishReason } as TextStreamPart<any>
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

  it('coalesces a burst of small deltas and flushes the complete fenced JSON', async (t) => {
    t.mock.method(performance, 'now', () => 0)
    const value = { questions: ['A long question? '.repeat(100)] }
    const text = '```json\n' + JSON.stringify(value) + '\n```'
    const events = await Array.fromAsync(
      parseStreamingJson(streamText([...text]), schema, (value) => Array.isArray(value.questions)),
    )

    assert.deepEqual(events, [{ type: 'object', value }])
  })

  it('updates during a continuing stream and flushes the tail without waiting', async (t) => {
    let now = 0
    t.mock.method(performance, 'now', () => now)
    async function* chunks(): AsyncGenerator<TextStreamPart<any>> {
      yield { type: 'text-delta', textDelta: '{"questions":["first' }
      now = 25
      yield { type: 'text-delta', textDelta: ' second' }
      now = 50
      yield { type: 'text-delta', textDelta: ' third' }
      now = 55
      yield { type: 'text-delta', textDelta: ' fourth"]}' }
    }
    const events = await Array.fromAsync(
      parseStreamingJson(chunks(), schema, (value) => Array.isArray(value.questions)),
    )

    assert.deepEqual(events, [
      { type: 'object', value: { questions: ['first'] } },
      { type: 'object', value: { questions: ['first second third'] } },
      { type: 'object', value: { questions: ['first second third fourth'] } },
    ])
  })

  it('passes reasoning and errors through immediately while text is pending', async (t) => {
    t.mock.method(performance, 'now', () => 0)
    async function* chunks(): AsyncGenerator<TextStreamPart<any>> {
      yield { type: 'text-delta', textDelta: '{' }
      yield { type: 'text-delta', textDelta: '"questions":[' }
      yield { type: 'reasoning', textDelta: 'Thinking' }
      yield { type: 'error', error: new Error('upstream failed') }
      assert.fail('The consumer must be able to stop at the error without pulling more data')
    }
    const events = parseStreamingJson(chunks(), schema, (value) => Array.isArray(value.questions))

    assert.deepEqual((await events.next()).value, { type: 'reasoning', delta: 'Thinking' })
    assert.deepEqual((await events.next()).value, { type: 'error', message: 'upstream failed' })
    await events.return()
  })

  it('propagates upstream cancellation without flushing buffered text', async (t) => {
    t.mock.method(performance, 'now', () => 0)
    const abort = new DOMException('Cancelled', 'AbortError')
    let closed = false
    async function* chunks(): AsyncGenerator<TextStreamPart<any>> {
      try {
        yield { type: 'text-delta', textDelta: '{' }
        yield { type: 'text-delta', textDelta: '"questions":["pending"]}' }
        throw abort
      } finally {
        closed = true
      }
    }
    const events = parseStreamingJson(chunks(), schema, (value) => Array.isArray(value.questions))

    await assert.rejects(events.next(), (error) => error === abort)
    assert.equal(closed, true)
  })

  it('closes the upstream iterator when the consumer stops after an update', async () => {
    let closed = false
    async function* chunks(): AsyncGenerator<TextStreamPart<any>> {
      try {
        yield { type: 'text-delta', textDelta: '{"questions":[]}' }
        assert.fail('Stopped consumers must not pull more data')
      } finally {
        closed = true
      }
    }
    const events = parseStreamingJson(chunks(), schema, (value) => Array.isArray(value.questions))

    assert.equal((await events.next()).value?.type, 'object')
    await events.return()
    assert.equal(closed, true)
  })

  it('reports truncation when reasoning exhausts the output limit before any content', async () => {
    const events = await Array.fromAsync(
      parseStreamingJson(
        finishedStream([{ type: 'reasoning', textDelta: 'Thinking...' }], 'length'),
        schema,
        (value) => Array.isArray(value.questions),
      ),
    )

    assert.deepEqual(events, [
      { type: 'reasoning', delta: 'Thinking...' },
      { type: 'bad-end', rawText: '', finishReason: 'length' },
    ])
    assert.match(structuredOutputError(events[1] as { finishReason?: string }), /truncated/)
  })

  it('rejects truncated JSON even when the repaired prefix looks valid', async (t) => {
    t.mock.method(performance, 'now', () => 0)
    const events = await Array.fromAsync(
      parseStreamingJson(
        finishedStream([{ type: 'text-delta', textDelta: '{"questions":["cut off' }], 'length'),
        schema,
        (value) => Array.isArray(value.questions),
      ),
    )

    assert.deepEqual(events.at(-1), {
      type: 'bad-end',
      rawText: '{"questions":["cut off',
      finishReason: 'length',
    })
  })

  it('accepts valid JSON that finished normally', async () => {
    const events = await Array.fromAsync(
      parseStreamingJson(
        finishedStream([{ type: 'text-delta', textDelta: '{"questions":["a"]}' }], 'stop'),
        schema,
        (value) => Array.isArray(value.questions),
      ),
    )

    assert.deepEqual(events, [{ type: 'object', value: { questions: ['a'] } }])
  })

  it('keeps the generic message for invalid output that was not truncated', () => {
    assert.equal(structuredOutputError({ finishReason: 'stop' }), 'Invalid structured output')
    assert.equal(structuredOutputError({}), 'Invalid structured output')
  })
})
