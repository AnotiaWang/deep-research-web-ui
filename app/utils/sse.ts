const maxErrorBodyBytes = 8192

async function readLimitedBody(response: Response, limit: number) {
  const reader = response.body?.getReader()
  if (!reader) return ''

  const chunks: Uint8Array[] = []
  let size = 0
  let completed = false

  try {
    while (size < limit) {
      const { done, value } = await reader.read()
      if (done) {
        completed = true
        break
      }

      const chunk = value.subarray(0, limit - size)
      chunks.push(chunk)
      size += chunk.byteLength
      if (chunk.byteLength < value.byteLength) break
    }
  } finally {
    if (!completed) await reader.cancel().catch(() => {})
  }

  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(body)
}

async function validateSSEStreamResponse(response: Response) {
  if (!response.ok) {
    const body = (await readLimitedBody(response, maxErrorBodyBytes)).trim()
    throw new Error(`Request failed with HTTP ${response.status}${body ? `: ${body}` : ''}`)
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('text/event-stream')) {
    await response.body?.cancel().catch(() => {})
    throw new Error(`Expected an SSE response, received ${contentType || 'no Content-Type'}.`)
  }
}

function readSSEData(message: string) {
  const lines = message.split(/\r?\n/)
  const data = lines
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).replace(/^ /, ''))
  return data.length ? data.join('\n') : undefined
}

export async function* parseSSEStream(response: Response) {
  await validateSSEStreamResponse(response)
  const reader = response.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  let buffer = ''
  let completed = false

  try {
    while (true) {
      const { done, value } = await reader.read()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })

      const messages = buffer.split(/\r?\n\r?\n/)
      buffer = done ? '' : (messages.pop() ?? '')

      for (const message of messages) {
        const data = readSSEData(message)
        if (!data) continue
        if (data === '[DONE]') return

        try {
          yield JSON.parse(data)
        } catch (error) {
          throw new Error('The server returned malformed SSE data.', { cause: error })
        }
      }

      if (done) {
        completed = true
        return
      }
    }
  } finally {
    if (!completed) await reader.cancel().catch(() => {})
  }
}
