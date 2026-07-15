import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseSSEStream } from '../app/utils/sse.ts'

function sseResponse(chunks: Uint8Array[]) {
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk)
        controller.close()
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } },
  )
}

async function collect(response: Response) {
  const values = []
  for await (const value of parseSSEStream(response)) values.push(value)
  return values
}

describe('SSE parser', () => {
  it('handles CRLF, multiline data, comments, and split Unicode bytes', async () => {
    const bytes = new TextEncoder().encode(
      ': heartbeat\r\ndata: {"message":\r\ndata: "你好"}\r\n\r\ndata: [DONE]\r\n\r\n',
    )
    const split = bytes.findIndex((byte) => byte > 127) + 1

    assert.deepEqual(await collect(sseResponse([bytes.slice(0, split), bytes.slice(split)])), [
      { message: '你好' },
    ])
  })

  it('rejects malformed JSON instead of treating it as an empty success', async () => {
    const response = sseResponse([new TextEncoder().encode('data: {broken}\n\n')])

    await assert.rejects(collect(response), /malformed SSE data/)
  })

  it('rejects non-SSE responses', async () => {
    const response = new Response('{}', {
      headers: { 'Content-Type': 'application/json' },
    })

    await assert.rejects(collect(response), /Expected an SSE response/)
  })

  it('cancels a response body that remains open after DONE', async () => {
    let cancelled = false
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
        },
        cancel() {
          cancelled = true
        },
      }),
      { headers: { 'Content-Type': 'text/event-stream' } },
    )

    assert.deepEqual(await collect(response), [])
    assert.equal(cancelled, true)
  })

  it('reads at most 8 KiB from an HTTP error body', async () => {
    let cancelled = false
    const response = new Response(
      new ReadableStream({
        pull(controller) {
          controller.enqueue(new Uint8Array(16_384).fill(97))
        },
        cancel() {
          cancelled = true
        },
      }),
      { status: 500, headers: { 'Content-Type': 'text/plain' } },
    )

    await assert.rejects(collect(response), (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.ok(error.message.length < 8_300)
      return true
    })
    assert.equal(cancelled, true)
  })
})
