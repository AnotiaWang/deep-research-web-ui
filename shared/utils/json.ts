import { parsePartialJson } from '@ai-sdk/ui-utils'
import type { TextStreamPart } from 'ai'
import { z } from 'zod'

export type DeepPartial<T> = T extends object
  ? T extends Array<any>
    ? T
    : { [P in keyof T]?: DeepPartial<T[P]> }
  : T

export type ParseStreamingJsonEvent<T> =
  | { type: 'object'; value: DeepPartial<T> }
  | { type: 'reasoning'; delta: string }
  | { type: 'error'; message: string }
  /**
   * The call finished without complete, valid JSON. `finishReason` is `length` when the
   * output limit cut it off, which reasoning models can hit before writing any content.
   */
  | { type: 'bad-end'; rawText: string; finishReason?: string }

/** User-facing message for a `bad-end` event */
export function structuredOutputError(event: { finishReason?: string }) {
  return event.finishReason === 'length'
    ? 'Model output was truncated at the output token limit before valid JSON was produced. Reasoning models count thinking toward this limit; raise or unset the max output tokens setting.'
    : 'Invalid structured output'
}

/** Keep logs useful without dumping a whole response */
function excerpt(text: string, size = 500) {
  return text.length <= size * 2
    ? text
    : `${text.slice(0, size)}\n[... ${text.length - size * 2} chars omitted ...]\n${text.slice(-size)}`
}

export function removeJsonMarkdown(text: string) {
  text = text.trim()
  if (text.startsWith('```json')) {
    text = text.slice(7)
  } else if (text.startsWith('json')) {
    text = text.slice(4)
  } else if (text.startsWith('```')) {
    text = text.slice(3)
  }
  if (text.endsWith('```')) {
    text = text.slice(0, -3)
  }
  return text.trim()
}

/**
 * Parse streaming JSON text
 * @param fullStream Returned by AI SDK
 * @param _schema zod schema for type definition
 * @param isValid Custom validation function to check if the parsed JSON is valid
 */
export async function* parseStreamingJson<T extends z.ZodType>(
  fullStream: AsyncIterable<TextStreamPart<any>>,
  _schema: T,
  isValid: (value: DeepPartial<z.infer<T>>) => boolean,
): AsyncGenerator<ParseStreamingJsonEvent<z.infer<T>>> {
  let rawText = ''
  let reasoningLength = 0
  let finishReason: string | undefined
  let hasValidObject = false
  let parsedLength = 0
  let lastParsedAt = -Infinity

  function parsePendingText(): ParseStreamingJsonEvent<z.infer<T>> | undefined {
    if (rawText.length === parsedLength) return
    parsedLength = rawText.length
    lastParsedAt = performance.now()
    const parsed = parsePartialJson(removeJsonMarkdown(rawText))
    const isParseSuccessful =
      parsed.state === 'repaired-parse' || parsed.state === 'successful-parse'
    if (isParseSuccessful && isValid(parsed.value as any)) {
      hasValidObject = true
      return { type: 'object', value: parsed.value as DeepPartial<z.infer<T>> }
    }
  }

  for await (const chunk of fullStream) {
    if (chunk.type === 'finish') {
      finishReason = chunk.finishReason
      continue
    }
    if (chunk.type === 'reasoning') {
      reasoningLength += chunk.textDelta.length
      yield { type: 'reasoning', delta: chunk.textDelta }
      continue
    }
    if (chunk.type === 'error') {
      yield {
        type: 'error',
        message: chunk.error instanceof Error ? chunk.error.message : String(chunk.error),
      }
      continue
    }
    if (chunk.type === 'text-delta') {
      rawText += chunk.textDelta
      // Coalesce fast deltas before parsing and emitting the entire accumulated object.
      // Check on arrival so errors, reasoning, and upstream cancellation never wait on a timer.
      if (performance.now() - lastParsedAt >= 50) {
        const event = parsePendingText()
        if (event) yield event
      }
    }
  }

  // Flush the final text even when the stream finishes inside the update interval.
  const finalEvent = parsePendingText()
  if (finalEvent) yield finalEvent

  // Fail when JSON never became valid — including successful parses like `{}`
  // that do not satisfy the caller's isValid predicate. Truncated output also fails:
  // partial JSON can be repaired into a valid-looking but incomplete object.
  if (!hasValidObject || finishReason === 'length') {
    console.warn(
      `[parseStreamingJson] Failed to parse JSON (finishReason: ${finishReason ?? 'unknown'}, ` +
        `content: ${rawText.length} chars, reasoning: ${reasoningLength} chars): ` +
        excerpt(removeJsonMarkdown(rawText)),
    )
    yield { type: 'bad-end', rawText, finishReason }
  }
}
