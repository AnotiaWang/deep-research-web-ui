import { streamText } from 'ai'
import { z } from 'zod'
import zodToJsonSchema from 'zod-to-json-schema'
import type { ConfigWebSearchProvider } from '~~/shared/types/config'
import { parseStreamingJson, type DeepPartial } from '~~/shared/utils/json'
import { languagePrompt, resolveResponseLanguage, searchPlannerSystemPrompt } from '~~/lib/prompt'
import { throwAiError } from '~~/shared/utils/errors'
import {
  searchPlanSchema,
  searchPlanningRules,
  searchQueryGuidance,
  resolveSearchPlan,
  type SearchConstraints,
} from '~~/shared/utils/search-plan'
import { throwIfAborted } from '~~/shared/utils/abort'

export type SearchQuery = z.infer<typeof searchQueriesTypeSchema>['queries'][0]
export type PartialSearchQuery = DeepPartial<SearchQuery>

/**
 * Schema for {@link generateSearchQueries} without dynamic descriptions
 */
export const searchQueriesTypeSchema = z.object({
  queries: z.array(searchPlanSchema),
})

// take an user query, return a list of SERP queries
export function generateSearchQueries({
  query,
  originalQuery,
  numQueries = 3,
  learnings,
  language,
  searchLanguage,
  searchConstraints,
  searchProvider,
  aiConfig,
  signal,
}: {
  query: string
  /** Root user goal; kept when generating deeper follow-up queries */
  originalQuery?: string
  language: string
  numQueries?: number
  // optional, if provided, the research will continue from the last learning
  learnings?: string[]
  /** Force the LLM to generate serp queries in a certain language */
  searchLanguage?: string
  searchConstraints?: SearchConstraints
  searchProvider?: ConfigWebSearchProvider
  aiConfig: ConfigAi
  signal?: AbortSignal
}) {
  throwIfAborted(signal)
  const schema = searchQueriesTypeSchema
  const jsonSchema = JSON.stringify(zodToJsonSchema(schema))
  let lp = languagePrompt(language)

  if (searchLanguage && searchLanguage !== language) {
    lp += ` Write each "query" field in ${resolveResponseLanguage(searchLanguage)}. Keep "researchGoal" in the response language.`
  }

  const rootQuery = originalQuery?.trim()
  const focusBlock =
    rootQuery && rootQuery !== query.trim()
      ? [
          `Original user research goal:`,
          `<original_query>${rootQuery}</original_query>`,
          `Current research focus (generate queries for this focus while staying aligned with the original goal):`,
          `<prompt>${query}</prompt>`,
        ].join('\n')
      : `User research prompt:\n<prompt>${query}</prompt>`

  const prompt = [
    `Generate up to ${numQueries} distinct web search tasks. Return fewer when the focus is narrow.`,
    searchPlanningRules,
    searchQueryGuidance(searchProvider),
    searchConstraints
      ? `Inherited search constraints (keep the time window and domain restrictions): ${JSON.stringify(searchConstraints)}`
      : '',
    focusBlock,
    learnings?.length
      ? `Learnings from previous research — use them to go deeper and avoid repeating the same angles:\n${learnings.map((item) => `- ${item}`).join('\n')}`
      : '',
    `You MUST respond in JSON matching this JSON schema: ${jsonSchema}`,
    lp,
  ]
    .filter(Boolean)
    .join('\n\n')
  return streamText({
    model: getLanguageModel(aiConfig),
    system: searchPlannerSystemPrompt(),
    prompt,
    abortSignal: signal,
    onError({ error }) {
      throwAiError('generateSearchQueries', error)
    },
  })
}

/**
 * Plans a single replacement search, e.g. when user-supplied sources cannot be read.
 * Filters from `searchConstraints` are applied to the generated plan.
 */
export async function generateFallbackSearchPlan({
  onReasoning,
  ...params
}: Omit<Parameters<typeof generateSearchQueries>[0], 'numQueries' | 'learnings'> & {
  onReasoning: (delta: string) => void
}) {
  const generated = generateSearchQueries({ ...params, numQueries: 1 })
  let fallback: PartialSearchQuery | undefined
  for await (const chunk of parseStreamingJson(
    generated.fullStream,
    searchQueriesTypeSchema,
    (value) => !!value.queries?.length,
  )) {
    throwIfAborted(params.signal)
    if (chunk.type === 'object' && chunk.value.queries?.[0]) {
      fallback = chunk.value.queries[0]
    } else if (chunk.type === 'error' || chunk.type === 'bad-end') {
      throw new Error(chunk.type === 'error' ? chunk.message : 'Invalid structured output')
    } else if (chunk.type === 'reasoning') {
      onReasoning(chunk.delta)
    }
  }
  if (!fallback) throw new Error('No search query generated for source follow-up.')
  return resolveSearchPlan(searchPlanSchema.parse(fallback), params.searchConstraints)
}
