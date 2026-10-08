import { streamText } from 'ai'
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'

import { feedbackSystemPrompt, languagePrompt } from '~~/lib/prompt'
import { parseStreamingJson, type DeepPartial } from '~~/shared/utils/json'
import { throwAiError } from '~~/shared/utils/errors'
import { getLanguageModel, getMaxOutputTokens } from '~~/shared/utils/ai-model'
import { throwIfAborted } from '~~/shared/utils/abort'
import {
  estimateMaxSearches,
  researchPresetKeys,
  researchPresets,
  type ResearchPreset,
} from '~~/shared/utils/research-input'

type PartialFeedback = DeepPartial<z.infer<typeof feedbackTypeSchema>>

export const feedbackTypeSchema = z.object({
  questions: z.array(z.string()),
  /** Only requested with `suggestResearchMode`; validate before use, it is model output. */
  researchMode: z.enum(researchPresetKeys).optional(),
  researchModeReason: z.string().optional(),
})

const researchModeGuidance: Record<ResearchPreset, string> = {
  quick: 'a single fact or a narrow, well-defined question',
  standard: 'a typical topic that needs a few angles',
  deep: 'a complex, multi-faceted, comparative, or open-ended topic',
}

export function generateFeedback({
  query,
  language,
  numQuestions = 3,
  suggestResearchMode = false,
  aiConfig,
  signal,
}: {
  query: string
  language: string
  aiConfig: ConfigAi
  numQuestions?: number
  /** Also recommend how much searching the follow-up research needs */
  suggestResearchMode?: boolean
  signal?: AbortSignal
}) {
  throwIfAborted(signal)
  const questions = z
    .array(z.string())
    .describe(
      `Clarifying questions that materially improve research direction. Maximum ${numQuestions}. Empty array if the query is already clear.`,
    )
  const schema = suggestResearchMode
    ? z.object({
        questions,
        researchMode: z.enum(researchPresetKeys).describe('How much web research the query needs'),
        researchModeReason: z.string().describe('One short sentence explaining researchMode'),
      })
    : z.object({ questions })
  const jsonSchema = JSON.stringify(zodToJsonSchema(schema))
  const prompt = [
    `Given the user query below, ask up to ${numQuestions} follow-up questions that clarify research direction.`,
    `<query>${query}</query>`,
    `Guidelines:
- Prioritize scope, audience, time range, constraints, success criteria, and known unknowns.
- Each question should be specific and non-redundant.
- Do not ask about information already stated in the query.
- If the query is already clear enough to research well, return an empty "questions" array.
- Otherwise return as few questions as needed (often 1–2); never exceed ${numQuestions}.`,
    suggestResearchMode
      ? `Also choose researchMode for the web research that follows:
${researchPresetKeys
  .map((key) => {
    const { breadth, depth } = researchPresets[key]
    return `- "${key}" (up to ${estimateMaxSearches(breadth, depth)} searches): ${researchModeGuidance[key]}`
  })
  .join('\n')}
Pick the cheapest mode that can still answer the query well. Explain it in researchModeReason.`
      : '',
    `You MUST respond in JSON matching this JSON schema: ${jsonSchema}`,
    languagePrompt(language),
  ]
    .filter(Boolean)
    .join('\n\n')

  const stream = streamText({
    model: getLanguageModel(aiConfig),
    system: feedbackSystemPrompt(),
    prompt,
    maxTokens: getMaxOutputTokens(aiConfig),
    abortSignal: signal,
    onError({ error }) {
      throwAiError('generateFeedback', error)
    },
  })

  return parseStreamingJson(stream.fullStream, feedbackTypeSchema, (value: PartialFeedback) => {
    // Require an explicit questions array. Empty [] means "query is clear";
    // missing/undefined questions must not count as success.
    if (!Array.isArray(value.questions)) return false
    if (value.questions.length === 0) return true
    return value.questions.some(
      (question) => typeof question === 'string' && question.trim().length > 0,
    )
  })
}
