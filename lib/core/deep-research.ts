import { streamText } from 'ai'
import { z } from 'zod'
import { parseStreamingJson, type DeepPartial } from '~~/shared/utils/json'

import { trimPrompt } from '../ai/providers'
import { languagePrompt, systemPrompt } from '../prompt'
import zodToJsonSchema from 'zod-to-json-schema'
import { throwAiError } from '~~/shared/utils/errors'

export type ResearchResult = {
  learnings: ProcessedSearchResult['learnings']
}

export interface WriteFinalReportParams {
  prompt: string
  learnings: ProcessedSearchResult['learnings']
  language: string
  aiConfig: ConfigAi
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
      type: 'processing_serach_result'
      query: string
      result: PartialProcessedSearchResult
      nodeId: string
    }
  | {
      type: 'processing_serach_result_reasoning'
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
  numQueries = 3,
  learnings,
  language,
  searchLanguage,
  aiConfig,
}: {
  query: string
  language: string
  numQueries?: number
  // optional, if provided, the research will continue from the last learning
  learnings?: string[]
  /** Force the LLM to generate serp queries in a certain language */
  searchLanguage?: string
  aiConfig: ConfigAi
}) {
  const schema = z.object({
    queries: z
      .array(
        z
          .object({
            query: z.string().describe('The SERP query.'),
            researchGoal: z
              .string()
              .describe(
                'First talk about the goal of the research that this query is meant to accomplish, then go deeper into how to advance the research once the results are found, mention additional research directions. Be as specific as possible, especially for additional research directions. JSON reserved words should be escaped.',
              ),
          })
          .required({ query: true, researchGoal: true }),
      )
      .describe(`List of SERP queries, max of ${numQueries}`),
  })
  const jsonSchema = JSON.stringify(zodToJsonSchema(schema))
  let lp = languagePrompt(language)

  if (searchLanguage && searchLanguage !== language) {
    lp += ` Use ${searchLanguage} for the SERP queries.`
  }
  const prompt = [
    `Given the following prompt from the user, generate a list of highly effective Google search queries to research the topic. Return a maximum of ${numQueries} queries, but feel free to return less if the original prompt is clear. Make sure each query is creative, unique and not similar to each other: <prompt>${query}</prompt>`,
    learnings
      ? `Here are some learnings from previous research, use them to generate more specific queries: ${learnings.join(
          '\n',
        )}`
      : '',
    `You MUST respond in JSON matching this JSON schema: ${jsonSchema}`,
    lp,
  ].join('\n\n')
  return streamText({
    model: getLanguageModel(aiConfig),
    system: systemPrompt(),
    prompt,
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
  results,
  numLearnings = 5,
  numFollowUpQuestions = 3,
  language,
  aiConfig,
}: {
  query: string
  results: WebSearchResult[]
  language: string
  numLearnings?: number
  numFollowUpQuestions?: number
  aiConfig: ConfigAi
}) {
  const schema = z.object({
    learnings: z
      .array(
        z.object({
          url: z.string().describe('The source URL from which this learning was extracted'),
          learning: z
            .string()
            .describe(
              'A detailed, information-dense insight extracted from the search results. Include specific entities, metrics, numbers, and dates when available',
            ),
        }),
      )
      .describe(
        `Collection of key learnings extracted from search results, each with its source URL. Maximum of ${numLearnings} learnings.`,
      ),
    followUpQuestions: z
      .array(z.string())
      .describe(
        `List of relevant follow-up questions to explore the topic further, designed to uncover additional insights. Maximum of ${numFollowUpQuestions} questions.`,
      ),
  })
  const jsonSchema = JSON.stringify(zodToJsonSchema(schema))
  const contents = results.map((item) => trimPrompt(item.content, aiConfig.contextSize))
  const prompt = [
    `Given the following contents from a SERP search for the query <query>${query}</query>, extract ${numLearnings} key learnings from the contents. Make sure each learning is unique and not similar to each other. The learnings should be as detailed and information dense as possible. Include any entities like people, places, companies, products, things, etc in the learnings, as well as any exact metrics, numbers, or dates. Also generate up to ${numFollowUpQuestions} follow-up questions that could help explore this topic further.`,
    `<contents>${contents
      .map((content, index) => `<content url="${results[index]!.url}">\n${content}\n</content>`)
      .join('\n')}</contents>`,
    `You MUST respond in JSON matching this JSON schema: ${jsonSchema}`,
    languagePrompt(language),
  ].join('\n\n')

  return streamText({
    model: getLanguageModel(aiConfig),
    system: systemPrompt(),
    prompt,
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
}: WriteFinalReportParams) {
  const learningsString = trimPrompt(
    learnings
      .map(
        (learning, index) =>
          `<learning index="${index + 1}">
${learning.learning}
</learning>`,
      )
      .join('\n'),
    aiConfig.contextSize,
  )
  const _prompt = [
    `Given the following prompt from the user, write a final report on the topic using the learnings from research. Make it as detailed as possible, aim for 3 or more pages, include ALL the key insights from research.`,
    `<prompt>${prompt}</prompt>`,
    `Here are all the learnings from previous research:`,
    `<learnings>\n${learningsString}\n</learnings>`,
    `Write the report using Markdown. Be factual, NEVER lie or make things up. Cite learnings from previous research when needed, using numbered citations like "[1]". Each citation should correspond to the index of the source in your learnings list. DO NOT include the actual URLs in the report text - only use the citation numbers.`,
    languagePrompt(language),
    `## Deep Research Report`,
  ].join('\n\n')

  return streamText({
    model: getLanguageModel(aiConfig),
    system: systemPrompt(),
    prompt: _prompt,
    onError({ error }) {
      throwAiError('writeFinalReport', error)
    },
  })
}

function childNodeId(parentNodeId: string, currentIndex: number) {
  return `${parentNodeId}-${currentIndex}`
}

export async function deepResearch({
  query,
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
}: {
  query: string
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
    options: { maxResults?: number; lang?: string },
  ) => Promise<WebSearchResult[]>
  pLimitInstance?: any
}) {
  const language = languageCode
  const searchLanguage = searchLanguageCode

  // Use provided pLimit or create a simple one if not provided
  const limit = pLimitInstance || {
    async(fn: () => Promise<any>) {
      return fn()
    },
    concurrency: 2,
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
        learnings: learnings?.map((item) => item.learning),
        numQueries: breadth,
        language,
        searchLanguage,
        aiConfig,
      })

      for await (const chunk of parseStreamingJson(
        searchQueriesResult.fullStream,
        searchQueriesTypeSchema,
        (value) => !!value.queries?.length && !!value.queries[0]?.query,
      )) {
        if (chunk.type === 'object' && chunk.value.queries) {
          // Temporary fix: Exclude queries that equals `undefined`
          // Currently only being reported to be seen on GPT-4o, where the model simply returns `undefined` for certain questions
          // https://github.com/AnotiaWang/deep-research-web-ui/issues/7
          searchQueries = chunk.value.queries
            .filter((q) => q.query !== 'undefined')
            .map((q, i) => ({
              ...q,
              nodeId: childNodeId(nodeId, i),
            }))
          for (let i = 0; i < searchQueries.length; i++) {
            onProgress({
              type: 'generating_query',
              result: searchQueries[i]!,
              nodeId: searchQueries[i]!.nodeId,
              parentNodeId: nodeId,
            })
          }
        } else if (chunk.type === 'reasoning') {
          // Reasoning part goes to the parent node
          onProgress({
            type: 'generating_query_reasoning',
            delta: chunk.delta,
            nodeId,
          })
        } else if (chunk.type === 'error') {
          onProgress({
            type: 'error',
            message: chunk.message,
            nodeId,
          })
          break
        } else if (chunk.type === 'bad-end') {
          onProgress({
            type: 'error',
            message: 'Invalid structured output',
            nodeId,
          })
          break
        }
      }

      onProgress({
        type: 'node_complete',
        nodeId,
      })

      for (const searchQuery of searchQueries) {
        onProgress({
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
          if (!searchQuery?.query) {
            return {
              learnings: [],
            }
          }
          onProgress({
            type: 'searching',
            query: searchQuery.query,
            nodeId: searchQuery.nodeId,
          })
          try {
            // search the web
            const results = await webSearchFunction(searchQuery.query, {
              maxResults: 5,
              lang: languageCode,
            })
            if (!results.length) {
              throw new Error('No search results found')
            }
            console.log(
              `[DeepResearch] Searched "${searchQuery.query}", found ${results.length} contents`,
            )

            onProgress({
              type: 'search_complete',
              results,
              nodeId: searchQuery.nodeId,
            })
            // Breadth for the next search is half of the current breadth
            const nextBreadth = Math.ceil(breadth / 2)

            const searchResultGenerator = processSearchResult({
              query: searchQuery.query,
              results,
              numFollowUpQuestions: nextBreadth,
              language,
              aiConfig,
            })
            let searchResult: PartialProcessedSearchResult = {}

            for await (const chunk of parseStreamingJson(
              searchResultGenerator.fullStream,
              searchResultTypeSchema,
              (value) => !!value.learnings?.length,
            )) {
              if (chunk.type === 'object') {
                searchResult = chunk.value
                onProgress({
                  type: 'processing_serach_result',
                  result: chunk.value,
                  query: searchQuery.query,
                  nodeId: searchQuery.nodeId,
                })
              } else if (chunk.type === 'reasoning') {
                onProgress({
                  type: 'processing_serach_result_reasoning',
                  delta: chunk.delta,
                  nodeId: searchQuery.nodeId,
                })
              } else if (chunk.type === 'error') {
                onProgress({
                  type: 'error',
                  message: chunk.message,
                  nodeId: searchQuery.nodeId,
                })
                break
              } else if (chunk.type === 'bad-end') {
                onProgress({
                  type: 'error',
                  message: 'Invalid structured output',
                  nodeId: searchQuery.nodeId,
                })
                break
              }
            }
            console.log(`Processed search result for ${searchQuery.query}`, searchResult)
            // Assign URL titles to learnings
            searchResult.learnings = searchResult.learnings?.map((learning) => {
              return {
                ...learning,
                title: results.find((r) => r.url === learning.url)?.title,
              }
            })
            const allLearnings = [...(learnings ?? []), ...(searchResult.learnings ?? [])]
            const nextDepth = currentDepth + 1

            onProgress({
              type: 'node_complete',
              result: {
                learnings: searchResult.learnings ?? [],
                followUpQuestions: searchResult.followUpQuestions ?? [],
              },
              nodeId: searchQuery.nodeId,
            })

            if (nextDepth <= maxDepth && searchResult.followUpQuestions?.length) {
              console.warn(`Researching deeper, breadth: ${nextBreadth}, depth: ${nextDepth}`)

              const nextQuery = `
              Previous research goal: ${searchQuery.researchGoal}
              Follow-up research directions: ${searchResult.followUpQuestions.map((q) => `\n${q}`).join('')}
            `.trim()

              // Add concurrency by 1, and do next recursive search
              limit.concurrency++
              try {
                const r = await deepResearch({
                  query: nextQuery,
                  breadth: nextBreadth,
                  maxDepth,
                  learnings: allLearnings,
                  onProgress,
                  currentDepth: nextDepth,
                  nodeId: searchQuery.nodeId,
                  languageCode,
                  aiConfig,
                  webSearchFunction,
                  pLimitInstance: limit,
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
            console.error(`Error in node ${searchQuery.nodeId} for query ${searchQuery.query}`, e)
            onProgress({
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
      onProgress({
        type: 'complete',
        learnings: finalLearnings,
      })
    }
    return {
      learnings: finalLearnings,
    }
  } catch (error: any) {
    console.error(error)
    onProgress({
      type: 'error',
      message: error?.message ?? 'Something went wrong',
      nodeId,
    })
    return {
      learnings: [],
    }
  }
}
