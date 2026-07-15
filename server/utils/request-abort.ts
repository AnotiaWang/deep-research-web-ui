import type { H3Event } from 'h3'

export type RequestAbortReason = 'disconnect' | 'stream-cancel' | 'timeout'

export function serverOperationTimeout(clientTimeoutMs: number) {
  return Math.max(1000, clientTimeoutMs - 5000)
}

export function createRequestAbort(event: H3Event, timeoutMs: number) {
  const controller = new AbortController()
  let abortReason: RequestAbortReason | undefined

  const abort = (reason: RequestAbortReason) => {
    if (controller.signal.aborted) return
    abortReason = reason
    controller.abort()
  }
  const onRequestAborted = () => abort('disconnect')
  const onResponseClose = () => {
    if (!event.node.res.writableEnded) abort('disconnect')
  }
  const timeout = setTimeout(() => abort('timeout'), timeoutMs)

  event.node.req.once('aborted', onRequestAborted)
  event.node.res.once('close', onResponseClose)

  function cleanup() {
    clearTimeout(timeout)
    event.node.req.off('aborted', onRequestAborted)
    event.node.res.off('close', onResponseClose)
  }

  function canWrite() {
    return (
      abortReason !== 'disconnect' &&
      abortReason !== 'stream-cancel' &&
      !event.node.res.destroyed &&
      !event.node.res.writableEnded
    )
  }

  return {
    signal: controller.signal,
    abort,
    reason: () => abortReason,
    canWrite,
    cleanup,
  }
}
