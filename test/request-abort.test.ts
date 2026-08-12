import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { describe, it } from 'node:test'
import type { H3Event } from 'h3'
import { createRequestAbort, serverOperationTimeout } from '../server/utils/request-abort.ts'

function createEvent() {
  const req = new EventEmitter()
  const res = Object.assign(new EventEmitter(), {
    destroyed: false,
    writableEnded: false,
  })

  return {
    event: { node: { req, res } } as unknown as H3Event,
    req,
    res,
  }
}

describe('server request abort lifecycle', () => {
  it('aborts upstream work and blocks writes after a client disconnect', () => {
    const { event, req } = createEvent()
    const requestAbort = createRequestAbort(event, 10_000)

    req.emit('aborted')

    assert.equal(requestAbort.signal.aborted, true)
    assert.equal(requestAbort.reason(), 'disconnect')
    assert.equal(requestAbort.canWrite(), false)
    requestAbort.cleanup()
    assert.equal(req.listenerCount('aborted'), 0)
  })

  it('allows a timeout error frame while the response is still writable', async () => {
    const { event } = createEvent()
    const requestAbort = createRequestAbort(event, 5)

    await new Promise((resolve) => setTimeout(resolve, 10))

    assert.equal(requestAbort.signal.aborted, true)
    assert.equal(requestAbort.reason(), 'timeout')
    assert.equal(requestAbort.canWrite(), true)
    requestAbort.cleanup()
  })

  it('keeps the server watchdog ahead of the browser deadline', () => {
    assert.equal(serverOperationTimeout(120_000), 115_000)
    assert.equal(serverOperationTimeout(3_000), 1_000)
  })
})
