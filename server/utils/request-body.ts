import type { H3Event } from 'h3'

/**
 * Byte ceilings for request bodies, enforced before anything is parsed or tokenized.
 *
 * h3's `readBody` buffers an entire payload with no size limit, and every string in these bodies is
 * later run through the tokenizer synchronously: a 42 MiB report body once blocked the event loop
 * for 23 seconds. The per-field limits in the schemas bound each value, but only a body-level cap
 * bounds the sum, and it has to run before the body is read.
 */
export const REQUEST_BODY_LIMITS = {
  '/api/research': 2 * 1024 * 1024,
  '/api/feedback': 256 * 1024,
  '/api/report': 8 * 1024 * 1024,
} as const

export class RequestBodyTooLargeError extends Error {
  override name = 'RequestBodyTooLargeError'
  readonly limit: number
  constructor(limit: number) {
    super(`Request body exceeds ${Math.floor(limit / 1024)} KiB.`)
    this.limit = limit
  }
}

async function readLimited(request: NodeJS.ReadableStream, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer)
    size += buffer.byteLength
    if (size > limit) throw new RequestBodyTooLargeError(limit)
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

/** Reads and validates a JSON body, turning size and parse failures into 413/400 responses. */
export async function readApiBody(event: H3Event, limit: number): Promise<unknown> {
  try {
    return await readJsonBodyWithLimit(event, limit)
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      throw createError({ statusCode: 413, statusMessage: error.message })
    }
    throw error
  }
}

/**
 * Reads and parses a JSON body, refusing anything larger than `limit`.
 *
 * A declared `Content-Length` is rejected without touching the stream; a chunked upload is counted
 * as it arrives, so an attacker cannot skip the check by omitting the header.
 */
export async function readJsonBodyWithLimit(event: H3Event, limit: number): Promise<unknown> {
  const declared = Number.parseInt(getHeader(event, 'content-length') ?? '', 10)
  if (Number.isFinite(declared) && declared > limit) throw new RequestBodyTooLargeError(limit)

  const raw = await readLimited(event.node.req, limit)
  if (!raw.length) return undefined
  try {
    return JSON.parse(raw.toString('utf8'))
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'Invalid JSON body' })
  }
}
