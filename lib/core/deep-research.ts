import { streamText } from 'ai'
import { z } from 'zod'
import { parseStreamingJson, type DeepPartial } from '~~/shared/utils/json'

import { trimPrompt } from '../ai/providers'
import {
  languagePrompt,
  learningExtractorSystemPrompt,
  reportSystemPrompt,
  resolveResponseLanguage,
  searchPlannerSystemPrompt,
} from '../prompt'
import zodToJsonSchema from 'zod-to-json-schema'
import { throwAiError } from '~~/shared/utils/errors'
import type { ResearchResult } from '~~/shared/types/research-session'
import { normalizeGeneratedSearchQueries } from '~~/shared/utils/search-query'
import {
  escapePromptAttribute,
  finalizeLearningsFromSearchResults,
} from '~~/shared/utils/search-learning'
import { abortable, isAbortError, throwIfAborted } from '~~/shared/utils/abort'

export type { ResearchResult } from '~~/shared/types/research-session'

export interface WriteFinalReportParams {
  prompt: string
  learnings: ProcessedSearchResult['learnings']
  language: string
  aiConfig: ConfigAi
  signal?: AbortSignal
}

// Used for streaming response
export type SearchQuery = z.infer<typeof searchQueriesTypeSchema>['queries'][0]
export type PartialSearchQuery = DeepPartial<SearchQuery>
export type ProcessedSearchResult = z.infer<typeof searchResultTypeSchema>
export type PartialProcessedSearchResult = DeepPartial<ProcessedSearchResult>

export type ResearchStep =
  | {
      type: 'generating_query'
      result: PartialSearchQuery
      nodeId: string
      parentNodeId?: string
    }
  | { type: 'generating_query_reasoning'; delta: string; nodeId: string }
  | {
      type: 'generated_query'
      query: string
      result: PartialSearchQuery
      nodeId: string
    }
  | { type: 'searching'; query: string; nodeId: string }
  | { type: 'search_complete'; results: WebSearchResult[]; nodeId: string }
  | {
      type: 'processing_search_result'
      query: string
      result: PartialProcessedSearchResult
      nodeId: string
    }
  | {
      type: 'processing_search_result_reasoning'
      delta: string
      nodeId: string
    }
  | {
      type: 'node_complete'
      result?: ProcessedSearchResult
      nodeId: string
    }
  | { type: 'error'; message: string; nodeId: string }
  | { type: 'complete'; learnings: ProcessedSearchResult['learnings'] }

/**
 * Schema for {@link generateSearchQueries} without dynamic descriptions
 */
export const searchQueriesTypeSchema = z.object({
  queries: z.array(
    z.object({
      query: z.string(),
      researchGoal: z.string(),
    }),
  ),
})

// take an user query, return a list of SERP queries
export function generateSearchQueries({
  query,
  originalQuery,
  numQueries = 3,
  learnings,
  language,
  searchLanguage,
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
  aiConfig: ConfigAi
  signal?: AbortSignal
}) {
  throwIfAborted(signal)
  const schema = z.object({
    queries: z
      .array(
        z
          .object({
            query: z.string().describe('Concrete SERP query string.'),
            researchGoal: z
              .string()
              .describe(
                'What this query should uncover, and one specific next step after results arrive.',
              ),
          })
          .required({ query: true, researchGoal: true }),
      )
      .describe(`SERP queries, maximum ${numQueries}`),
  })
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
    `Generate up to ${numQueries} highly effective web search queries for the topic below. Return fewer when the focus is already narrow. Each query must be specific, mutually distinct, and useful for a search engine (concrete entities, time ranges, comparisons, or facets). Prefer precision over clever wording. Operators like site:, filetype:, or quoted phrases are allowed when helpful.`,
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

export const searchResultTypeSchema = z.object({
  learnings: z.array(
    z.object({
      url: z.string(),
      learning: z.string(),
      /** This is added in {@link deepResearch} */
      title: z.string().optional(),
    }),
  ),
  followUpQuestions: z.array(z.string()),
})

function processSearchResult({
  query,
  researchGoal,
  results,
  numLearnings = 5,
  numFollowUpQuestions = 3,
  language,
  aiConfig,
  signal,
}: {
  query: string
  researchGoal?: string
  results: WebSearchResult[]
  language: string
  numLearnings?: number
  numFollowUpQuestions?: number
  aiConfig: ConfigAi
  signal?: AbortSignal
}) {
  throwIfAborted(signal)
  const allowedUrls = results.map((item) => item.url)
  const schema = z.object({
    learnings: z
      .array(
        z.object({
          url: z.string().describe('Source URL copied exactly from the provided contents list'),
          learning: z
            .string()
            .describe(
              'Information-dense insight grounded in that URL. Include entities, metrics, numbers, and dates when present.',
            ),
        }),
      )
      .describe(`Key learnings, up to ${numLearnings}`),
    followUpQuestions: z
      .array(z.string())
      .describe(
        `Follow-up research directions that fill gaps left by these results, up to ${numFollowUpQuestions}`,
      ),
  })
  const jsonSchema = JSON.stringify(zodToJsonSchema(schema))
  const contents = results.map((item) => trimPrompt(item.content, aiConfig.contextSize))
  const prompt = [
    `From the SERP contents for <query>${query}</query>, extract up to ${numLearnings} unique, information-dense learnings. Do not aim for a fixed count if fewer high-quality insights exist.`,
    researchGoal
      ? `Research goal for this query:\n<research_goal>${researchGoal}</research_goal>`
      : '',
    `Rules:
- Each learning must be grounded in the provided contents.
- Each "url" MUST be copied exactly from this allow-list: ${JSON.stringify(allowedUrls)}
- Never invent or rewrite URLs.
- Prefer people, organizations, products, metrics, numbers, and dates over generic statements.
- Also generate up to ${numFollowUpQuestions} follow-up questions that target remaining gaps or contradictions.`,
    `<contents>${contents
      .map(
        (content, index) =>
          `<content url="${escapePromptAttribute(results[index]!.url)}">\n${content}\n</content>`,
      )
      .join('\n')}</contents>`,
    `You MUST respond in JSON matching this JSON schema: ${jsonSchema}`,
    languagePrompt(language),
  ]
    .filter(Boolean)
    .join('\n\n')

  return streamText({
    model: getLanguageModel(aiConfig),
    system: learningExtractorSystemPrompt(),
    prompt,
    abortSignal: signal,
    onError({ error }) {
      throwAiError('processSearchResult', error)
    },
  })
}

export function writeFinalReport({
  prompt,
  learnings,
  language,
  aiConfig,
  signal,
}: WriteFinalReportParams) {
  throwIfAborted(signal)
  const learningsString = trimPrompt(
    learnings
      .map(
        (learning, index) =>
          `<learning index="${index + 1}" url="${escapePromptAttribute(learning.url)}">
${learning.learning}
</learning>`,
      )
      .join('\n'),
    aiConfig.contextSize,
  )
  const _prompt = [
    `Write a final research report for the user prompt below, using only the provided learnings.`,
    `<prompt>${prompt}</prompt>`,
    `Learnings (citation index = the learning's index attribute):`,
    `<learnings>\n${learningsString}\n</learnings>`,
    `Requirements:
- Markdown only. Target roughly 1,500–3,000 words unless the learnings cannot support that depth.
- Be factual; never invent claims, numbers, or sources beyond the learnings. If the learnings block looks truncated, prioritize the densest remaining insights and note coverage limits.
- Use numbered citations like [1] that match learning index values. Do not put raw URLs in the report body.
- Prefer evidence over authority claims; call out conflicts and uncertainty explicitly.`,
    languagePrompt(language),
  ].join('\n\n')

  return streamText({
    model: getLanguageModel(aiConfig),
    system: reportSystemPrompt(),
    prompt: _prompt,
    abortSignal: signal,
    onError({ error }) {
      throwAiError('writeFinalReport', error)
    },
  })
}

export async function deepResearch({
  query,
  originalQuery,
  breadth,
  maxDepth,
  languageCode,
  aiConfig,
  searchLanguageCode,
  learnings,
  onProgress,
  currentDepth,
  nodeId = '0',
  retryNode,
  webSearchFunction,
  pLimitInstance,
  signal,
}: {
  query: string
  /** Root user goal preserved across recursive deep-research calls */
  originalQuery?: string
  breadth: number
  maxDepth: number
  /** The language of generated response */
  languageCode: Locale
  /** The AI model configuration */
  aiConfig: ConfigAi
  /** The language of SERP query */
  searchLanguageCode?: Locale
  /** Accumulated learnings from all nodes visited so far */
  learnings?: Array<{ url: string; learning: string }>
  currentDepth: number
  /** Current node ID. Used for recursive calls */
  nodeId?: string
  /** The Node ID to retry. Passed from DeepResearch.vue */
  retryNode?: any
  onProgress: (step: ResearchStep) => void
  webSearchFunction: (
    query: string,
    options: { maxResults?: number; lang?: string; signal?: AbortSignal },
  ) => Promise<WebSearchResult[]>
  pLimitInstance?: any
  signal?: AbortSignal
}) {
  throwIfAborted(signal)
  const language = languageCode
  const searchLanguage = searchLanguageCode
  const rootQuery = originalQuery ?? query

  // Use provided pLimit or create a simple one if not provided
  const limit = pLimitInstance || {
    async(fn: () => Promise<any>) {
      return fn()
    },
    concurrency: 2,
  }
  const progress = (step: ResearchStep) => {
    throwIfAborted(signal)
    onProgress(step)
  }

  try {
    let searchQueries: Array<PartialSearchQuery & { nodeId: string }> = []

    // If retryNode is provided and not a root node, just use the query from the node
    if (retryNode && retryNode.id !== '0') {
      nodeId = retryNode.id
      searchQueries = [
        {
          query: retryNode.label,
          researchGoal: retryNode.researchGoal,
          nodeId,
        },
      ]
    }
    // Otherwise (fresh start or retrying on root node)
    else {
      const searchQueriesResult = generateSearchQueries({
        query,
        originalQuery: rootQuery,
        learnings: learnings?.map((item) => item.learning),
        numQueries: breadth,
        language,
        searchLanguage,
        aiConfig,
        signal,
      })

      for await (const chunk of parseStreamingJson(
        searchQueriesResult.fullStream,
        searchQueriesTypeSchema,
        (value) => !!value.queries?.length && !!value.queries[0]?.query,
      )) {
        throwIfAborted(signal)
        if (chunk.type === 'object' && chunk.value.queries) {
          searchQueries = normalizeGeneratedSearchQueries(chunk.value.queries, nodeId)
          for (let i = 0; i < searchQueries.length; i++) {
            progress({
              type: 'generating_query',
              result: searchQueries[i]!,
              nodeId: searchQueries[i]!.nodeId,
              parentNodeId: nodeId,
            })
          }
        } else if (chunk.type === 'reasoning') {
          // Reasoning part goes to the parent node
          progress({
            type: 'generating_query_reasoning',
            delta: chunk.delta,
            nodeId,
          })
        } else if (chunk.type === 'error') {
          progress({
            type: 'error',
            message: chunk.message,
            nodeId,
          })
          break
        } else if (chunk.type === 'bad-end') {
          progress({
            type: 'error',
            message: 'Invalid structured output',
            nodeId,
          })
          break
        }
      }

      progress({
        type: 'node_complete',
        nodeId,
      })

      for (const searchQuery of searchQueries) {
        progress({
          type: 'generated_query',
          query: searchQuery.query!,
          result: searchQuery,
          nodeId: searchQuery.nodeId,
        })
      }
    }

    // Run in parallel and limit the concurrency
    const results = await Promise.all(
      searchQueries.map((searchQuery) =>
        limit(async () => {
          throwIfAborted(signal)
          if (!searchQuery?.query) {
            return {
              learnings: [],
            }
          }
          progress({
            type: 'searching',
            query: searchQuery.query,
            nodeId: searchQuery.nodeId,
          })
          try {
            // search the web
            const results = await abortable(
              webSearchFunction(searchQuery.query, {
                maxResults: 5,
                lang: languageCode,
                signal,
              }),
              signal,
            )
            throwIfAborted(signal)
            if (!results.length) {
              throw new Error('No search results found')
            }
            console.log(
              `[DeepResearch] Searched "${searchQuery.query}", found ${results.length} contents`,
            )

            progress({
              type: 'search_complete',
              results,
              nodeId: searchQuery.nodeId,
            })
            // Breadth for the next search is half of the current breadth
            const nextBreadth = Math.ceil(breadth / 2)

            const searchResultGenerator = processSearchResult({
              query: searchQuery.query,
              researchGoal: searchQuery.researchGoal,
              results,
              numFollowUpQuestions: nextBreadth,
              language,
              aiConfig,
              signal,
            })
            let searchResult: PartialProcessedSearchResult = {}

            for await (const chunk of parseStreamingJson(
              searchResultGenerator.fullStream,
              searchResultTypeSchema,
              (value) => !!value.learnings?.length,
            )) {
              throwIfAborted(signal)
              if (chunk.type === 'object') {
                searchResult = chunk.value
                progress({
                  type: 'processing_search_result',
                  result: chunk.value,
                  query: searchQuery.query,
                  nodeId: searchQuery.nodeId,
                })
              } else if (chunk.type === 'reasoning') {
                progress({
                  type: 'processing_search_result_reasoning',
                  delta: chunk.delta,
                  nodeId: searchQuery.nodeId,
                })
              } else if (chunk.type === 'error') {
                progress({
                  type: 'error',
                  message: chunk.message,
                  nodeId: searchQuery.nodeId,
                })
                break
              } else if (chunk.type === 'bad-end') {
                progress({
                  type: 'error',
                  message: 'Invalid structured output',
                  nodeId: searchQuery.nodeId,
                })
                break
              }
            }
            console.log(`Processed search result for ${searchQuery.query}`, searchResult)
            searchResult.learnings = finalizeLearningsFromSearchResults(
              searchResult.learnings,
              results,
            )
            const allLearnings = [...(learnings ?? []), ...(searchResult.learnings ?? [])]
            const nextDepth = currentDepth + 1

            progress({
              type: 'node_complete',
              result: {
                learnings: searchResult.learnings ?? [],
                followUpQuestions: searchResult.followUpQuestions ?? [],
              },
              nodeId: searchQuery.nodeId,
            })

            if (nextDepth <= maxDepth && searchResult.followUpQuestions?.length) {
              throwIfAborted(signal)
              console.warn(`Researching deeper, breadth: ${nextBreadth}, depth: ${nextDepth}`)

              const nextQuery = [
                `Previous research goal: ${searchQuery.researchGoal}`,
                `Follow-up research directions:`,
                ...searchResult.followUpQuestions.map((q) => `- ${q}`),
              ].join('\n')

              // Add concurrency by 1, and do next recursive search
              limit.concurrency++
              try {
                const r = await deepResearch({
                  query: nextQuery,
                  originalQuery: rootQuery,
                  breadth: nextBreadth,
                  maxDepth,
                  learnings: allLearnings,
                  onProgress: progress,
                  currentDepth: nextDepth,
                  nodeId: searchQuery.nodeId,
                  languageCode,
                  searchLanguageCode,
                  aiConfig,
                  webSearchFunction,
                  pLimitInstance: limit,
                  signal,
                })
                return r
              } catch (error) {
                throw error
              } finally {
                limit.concurrency--
              }
            } else {
              return {
                learnings: allLearnings,
              }
            }
          } catch (e: any) {
            if (signal?.aborted || isAbortError(e)) throw e
            console.error(`Error in node ${searchQuery.nodeId} for query ${searchQuery.query}`, e)
            progress({
              type: 'error',
              message: e.message,
              nodeId: searchQuery.nodeId,
            })
            return {
              learnings: [],
            }
          }
        }),
      ),
    )
    throwIfAborted(signal)
    // Conclude results
    // Deduplicate
    const urlMap = new Map<string, true>()
    const finalLearnings: ProcessedSearchResult['learnings'] = []

    for (const result of results) {
      for (const learning of result.learnings) {
        if (!urlMap.has(learning.url)) {
          urlMap.set(learning.url, true)
          finalLearnings.push(learning)
        }
      }
    }
    // Complete should only be called once
    if (nodeId === '0') {
      progress({
        type: 'complete',
        learnings: finalLearnings,
      })
    }
    return {
      learnings: finalLearnings,
    }
  } catch (error: any) {
    if (signal?.aborted || isAbortError(error)) throw error
    console.error(error)
    progress({
      type: 'error',
      message: error?.message ?? 'Something went wrong',
      nodeId,
    })
    return {
      learnings: [],
    }
  }
}
