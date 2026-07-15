import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  abortable,
  isAbortError,
  isTimeoutError,
  OperationTimeoutError,
  throwIfAborted,
} from '../shared/utils/abort.ts'

describe('abort helpers', () => {
  it('rejects pending work as soon as the signal is aborted', async () => {
    const controller = new AbortController()
    const pending = abortable(new Promise(() => {}), controller.signal)

    controller.abort()

    await assert.rejects(pending, (error: unknown) => isAbortError(error))
    assert.throws(
      () => throwIfAborted(controller.signal),
      (error: unknown) => isAbortError(error),
    )
  })

  it('keeps operation timeouts distinct from user cancellation', () => {
    const error = new OperationTimeoutError('Research timed out.')

    assert.equal(isTimeoutError(error), true)
    assert.equal(isAbortError(error), false)
  })
})
