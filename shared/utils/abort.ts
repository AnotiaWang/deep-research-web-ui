export function createAbortError() {
  if (typeof DOMException !== 'undefined') {
    return new DOMException('The operation was aborted.', 'AbortError')
  }

  const error = new Error('The operation was aborted.')
  error.name = 'AbortError'
  return error
}

export function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError'
}

export class OperationTimeoutError extends Error {
  override name = 'TimeoutError'
}

export function isTimeoutError(error: unknown) {
  return error instanceof Error && error.name === 'TimeoutError'
}

function abortReason(signal: AbortSignal) {
  return signal.reason instanceof Error ? signal.reason : createAbortError()
}

export function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortReason(signal)
}

export function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise

  try {
    throwIfAborted(signal)
  } catch (error) {
    return Promise.reject(error)
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup()
      reject(abortReason(signal))
    }
    const cleanup = () => signal.removeEventListener('abort', onAbort)

    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (error) => {
        cleanup()
        reject(error)
      },
    )
  })
}
