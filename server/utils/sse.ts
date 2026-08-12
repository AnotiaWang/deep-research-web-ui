export function createSSEWriter(
  controller: ReadableStreamDefaultController<Uint8Array>,
  canWrite: () => boolean,
) {
  const encoder = new TextEncoder()
  let closed = false

  function write(value: unknown) {
    if (closed || !canWrite()) return false

    try {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`))
      return true
    } catch {
      closed = true
      return false
    }
  }

  function close() {
    if (closed || !canWrite()) return
    closed = true

    try {
      controller.close()
    } catch {
      // The client can cancel the stream between canWrite() and close().
    }
  }

  return { write, close }
}
