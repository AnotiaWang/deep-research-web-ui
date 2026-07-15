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
  /** The call finished with invalid content that can't be parsed as JSON */
  | { type: 'bad-end'; rawText: string }

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
  let isParseSuccessful = false

  for await (const chunk of fullStream) {
    if (chunk.type === 'reasoning') {
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
      const parsed = parsePartialJson(removeJsonMarkdown(rawText))

      isParseSuccessful = parsed.state === 'repaired-parse' || parsed.state === 'successful-parse'
      if (isParseSuccessful && isValid(parsed.value as any)) {
        yield {
          type: 'object',
          value: parsed.value as DeepPartial<z.infer<T>>,
        }
      }
    }
  }

  // If the last chunk parses failed, return an error
  if (!isParseSuccessful) {
    console.warn(`[parseStreamingJson] Failed to parse JSON: ${removeJsonMarkdown(rawText)}`)
    yield {
      type: 'bad-end',
      rawText,
    }
  }
}
