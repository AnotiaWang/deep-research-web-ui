import { Tiktoken } from 'js-tiktoken/lite'
import o200kBase from 'js-tiktoken/ranks/o200k_base'

import { RecursiveCharacterTextSplitter } from '~~/lib/ai/text-splitter'
import { DEFAULT_AI_CONTEXT_SIZE } from '~~/shared/utils/ai-model'

const MinChunkSize = 140
const encoder = new Tiktoken(o200kBase)

export const countTokens = (text: string) => encoder.encode(text).length

/**
 * Prompt tokens available after reserving output and message framing. Reasoning models
 * spend output tokens on thinking before the answer, so the default reserve is generous;
 * it only sizes the prompt, and the request carries no cap unless one is configured.
 * The o200k tokenizer undercounts for many non-OpenAI models, so keep a 10% margin.
 */
export function promptTokenBudget(options: {
  contextSize?: number
  /** Configured output cap; reserved exactly when set */
  maxOutputTokens?: number
  system: string
}) {
  const size = options.contextSize || DEFAULT_AI_CONTEXT_SIZE
  const reservedOutput = options.maxOutputTokens ?? Math.min(32_768, Math.floor(size / 4))
  return Math.floor((size - reservedOutput - countTokens(options.system) - 128) * 0.9)
}

// trim prompt to maximum context size
export function trimPrompt(prompt: string, contextSize?: number) {
  if (!prompt) {
    return ''
  }

  if (!contextSize) {
    contextSize = DEFAULT_AI_CONTEXT_SIZE
  }

  const length = encoder.encode(prompt).length
  if (length <= contextSize) {
    return prompt
  }

  const overflowTokens = length - contextSize
  // on average it's 3 characters per token, so multiply by 3 to get a rough estimate of the number of characters
  const chunkSize = prompt.length - overflowTokens * 3
  if (chunkSize < MinChunkSize) {
    return prompt.slice(0, MinChunkSize)
  }

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap: 0,
  })
  const trimmedPrompt = splitter.splitText(prompt)[0] ?? ''

  // last catch, there's a chance that the trimmed prompt is same length as the original prompt, due to how tokens are split & innerworkings of the splitter, handle this case by just doing a hard cut
  if (trimmedPrompt.length === prompt.length) {
    return trimPrompt(prompt.slice(0, chunkSize), contextSize)
  }

  // recursively trim until the prompt is within the context size
  return trimPrompt(trimmedPrompt, contextSize)
}
