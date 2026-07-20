import { streamText } from 'ai'
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'

import { feedbackSystemPrompt, languagePrompt } from '../prompt'
import { parseStreamingJson, type DeepPartial } from '~~/shared/utils/json'
import { throwAiError } from '~~/shared/utils/errors'
import { getLanguageModel } from '~~/shared/utils/ai-model'
import { throwIfAborted } from '~~/shared/utils/abort'

type PartialFeedback = DeepPartial<z.infer<typeof feedbackTypeSchema>>

export const feedbackTypeSchema = z.object({
  questions: z.array(z.string()),
})

export function generateFeedback({
  query,
  language,
  numQuestions = 3,
  aiConfig,
  signal,
}: {
  query: string
  language: string
  aiConfig: ConfigAi
  numQuestions?: number
  signal?: AbortSignal
}) {
  throwIfAborted(signal)
  const schema = z.object({
    questions: z
      .array(z.string())
      .describe(
        `Clarifying questions that materially improve research direction. Maximum ${numQuestions}. Empty array if the query is already clear.`,
      ),
  })
  const jsonSchema = JSON.stringify(zodToJsonSchema(schema))
  const prompt = [
    `Given the user query below, ask up to ${numQuestions} follow-up questions that clarify research direction.`,
    `<query>${query}</query>`,
    `Guidelines:
- Prioritize scope, audience, time range, constraints, success criteria, and known unknowns.
- Each question should be specific and non-redundant.
- Do not ask about information already stated in the query.
- If the query is already clear enough to research well, return {"questions":[]}.
- Otherwise return as few questions as needed (often 1–2); never exceed ${numQuestions}.`,
    `You MUST respond in JSON matching this JSON schema: ${jsonSchema}`,
    languagePrompt(language),
  ].join('\n\n')

  const stream = streamText({
    model: getLanguageModel(aiConfig),
    system: feedbackSystemPrompt(),
    prompt,
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
