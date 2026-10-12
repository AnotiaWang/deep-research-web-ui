import { createSourceReader, sourceReadLimits, type SourceReader } from '~~/lib/core/read-source'
import { assessSearchLearnings, type SearchAssessment } from '~~/shared/utils/search-assessment'
import { deduplicateLearnings } from '~~/shared/utils/research-learning'
import pLimit from 'p-limit'
import { z } from 'zod'
import { parseStreamingJson, structuredOutputError } from '~~/shared/utils/json'
import type { ResearchLearning } from '~~/shared/types/research-session'
import {
  searchPlanSchema,
  resolveSearchPlan,
  type SearchConstraints,
  type SearchPlan,
  type SearchLimitation,
} from '~~/shared/utils/search-plan'
import type { WebSearchFunction } from '~~/lib/core/web-search'
import { normalizeGeneratedSearchQueries } from '~~/shared/utils/search-query'
import { abortable, isAbortError, throwIfAborted } from '~~/shared/utils/abort'
import {
  generateFallbackSearchPlan,
  generateSearchQueries,
  searchQueriesTypeSchema,
  type PartialSearchQuery,
} from '~~/lib/core/search-queries'
import {
  processSearchResult,
  searchResultTypeSchema,
  type PartialProcessedSearchResult,
  type ProcessedSearchResult,
} from '~~/lib/core/extract-learnings'

export type { ResearchResult } from '~~/shared/types/research-session'

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
  | { type: 'reading_source'; nodeId: string }
  | { type: 'searching'; query: string; nodeId: string; searchPlan?: SearchPlan; attempt?: number }
  | {
      type: 'search_complete'
      results: WebSearchResult[]
      nodeId: string
      limitations?: SearchLimitation[]
    }
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
  | { type: 'no_evidence'; assessment: SearchAssessment; nodeId: string }
  | { type: 'error'; message: string; nodeId: string }
  | { type: 'complete'; learnings: ProcessedSearchResult['learnings'] }

export async function deepResearch({
  query,
  originalQuery,
  breadth,
  maxDepth,
  languageCode,
  aiConfig,
  searchLanguageCode,
  searchConstraints,
  learnings,
  onProgress,
  currentDepth,
  nodeId = '0',
  retryNode,
  sourceUrls,
  sourceReader,
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
  searchConstraints?: SearchConstraints
  /** Accumulated learnings from all nodes visited so far */
  learnings?: ResearchLearning[]
  currentDepth: number
  /** Current node ID. Used for recursive calls */
  nodeId?: string
  /** The Node ID to retry. Passed from DeepResearch.vue */
  retryNode?: any
  onProgress: (step: ResearchStep) => void
  webSearchFunction: WebSearchFunction
  sourceUrls?: string[]
  /** Internal operation-scoped runtime, propagated to recursive calls. */
  sourceReader?: SourceReader
  pLimitInstance?: any
  signal?: AbortSignal
}) {
  throwIfAborted(signal)
  const language = languageCode
  const searchLanguage = searchLanguageCode
  const rootQuery = originalQuery ?? query
  const reader = sourceReader ?? createSourceReader(webSearchFunction.readSource, signal)

  const limit = pLimitInstance ?? pLimit(2)
  const progress = (step: ResearchStep) => {
    throwIfAborted(signal)
    onProgress(step)
  }

  try {
    let searchQueries: Array<PartialSearchQuery & { nodeId: string }> = []

    // If retryNode is provided and not a root node, just use the query from the node
    if (sourceUrls?.length && reader.available) {
      searchQueries = [{ query, researchGoal: query, nodeId: `${nodeId}-0` }]
      progress({
        type: 'generating_query',
        result: searchQueries[0]!,
        nodeId: searchQueries[0]!.nodeId,
        parentNodeId: nodeId,
      })
      progress({ type: 'node_complete', nodeId })
    } else if (retryNode && retryNode.id !== '0') {
      nodeId = retryNode.id
      searchQueries = [
        {
          ...retryNode.searchPlan,
          query: retryNode.label,
          researchGoal: retryNode.researchGoal ?? retryNode.searchPlan?.researchGoal ?? rootQuery,
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
        searchConstraints,
        searchProvider: webSearchFunction.provider,
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
          searchQueries = normalizeGeneratedSearchQueries(chunk.value.queries, nodeId).slice(
            0,
            breadth,
          )
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
            message: structuredOutputError(chunk),
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
          let nodeLearnings: ResearchLearning[] = []
          try {
            let plan = resolveSearchPlan(searchPlanSchema.parse(searchQuery), searchConstraints)
            const nextBreadth = Math.ceil(breadth / 2)
            let searchResult: PartialProcessedSearchResult = {}
            let assessment: SearchAssessment | undefined
            let extractionRetried = false
            let readAttempted = false
            let missingQuestions = ''
            const readFirst = !!sourceUrls?.length && reader.available
            const planFallbackSearch = () =>
              generateFallbackSearchPlan({
                query,
                originalQuery: rootQuery,
                language,
                searchLanguage,
                searchConstraints,
                searchProvider: webSearchFunction.provider,
                aiConfig,
                signal,
                onReasoning: (delta) =>
                  progress({
                    type: 'generating_query_reasoning',
                    delta,
                    nodeId: searchQuery.nodeId,
                  }),
              })
            for (let attempt = readFirst ? 0 : 1; attempt <= 2; attempt++) {
              throwIfAborted(signal)
              if (attempt > 0)
                progress({
                  type: 'searching',
                  query: plan.query,
                  searchPlan: plan,
                  attempt,
                  nodeId: searchQuery.nodeId,
                })
              let limitations: SearchLimitation[] = []
              let results: WebSearchResult[]
              if (attempt === 0) {
                progress({ type: 'reading_source', nodeId: searchQuery.nodeId })
                readAttempted = true
                const pages = await Promise.all(
                  sourceUrls!.slice(0, sourceReadLimits.perNode).map((url) => reader.read({ url })),
                )
                results = pages.filter((page): page is WebSearchResult => !!page)
                if (!results.length) {
                  plan = await planFallbackSearch()
                  continue
                }
              } else
                results = await abortable(
                  webSearchFunction(plan.query, {
                    ...plan,
                    maxResults: 5,
                    lang: searchLanguageCode ?? languageCode,
                    signal,
                    onNotice: (value) => {
                      limitations = value
                    },
                  }),
                  signal,
                )
              throwIfAborted(signal)
              progress({
                type: 'search_complete',
                results: sourceMetadata(results),
                limitations,
                nodeId: searchQuery.nodeId,
              })
              reader.remember(results)
              while (true) {
                const searchResultGenerator = processSearchResult({
                  query: plan.query,
                  searchPlan: plan,
                  searchProvider: webSearchFunction.provider,
                  repairExtraction: extractionRetried,
                  canRead: reader.available && !readAttempted,
                  researchGoal: [plan.researchGoal, missingQuestions].filter(Boolean).join('\n'),
                  results,
                  numFollowUpQuestions: nextBreadth,
                  language,
                  aiConfig,
                  signal,
                })
                searchResult = {}

                for await (const chunk of parseStreamingJson(
                  searchResultGenerator.fullStream,
                  searchResultTypeSchema,
                  (value) => Array.isArray(value.learnings),
                )) {
                  throwIfAborted(signal)
                  if (chunk.type === 'object') {
                    searchResult = chunk.value
                    progress({
                      type: 'processing_search_result',
                      result: chunk.value,
                      query: plan.query,
                      nodeId: searchQuery.nodeId,
                    })
                  } else if (chunk.type === 'reasoning') {
                    progress({
                      type: 'processing_search_result_reasoning',
                      delta: chunk.delta,
                      nodeId: searchQuery.nodeId,
                    })
                  } else if (chunk.type === 'error') {
                    throw new Error(chunk.message)
                  } else if (chunk.type === 'bad-end') {
                    throw new Error(structuredOutputError(chunk))
                  }
                }

                const validated = searchResultTypeSchema
                  .extend({ relevantUrls: z.array(z.string()) })
                  .parse(searchResult)
                const checked = assessSearchLearnings(
                  validated.learnings,
                  results,
                  validated.relevantUrls,
                  extractionRetried,
                )
                assessment = checked.assessment
                nodeLearnings = deduplicateLearnings([...nodeLearnings, ...checked.learnings])
                searchResult = { ...validated, learnings: nodeLearnings }
                if (reader.available && !readAttempted && validated.readRequests?.length) {
                  readAttempted = true
                  const candidates = selectReadCandidates(validated.readRequests, results)
                  if (candidates.length) {
                    progress({ type: 'reading_source', nodeId: searchQuery.nodeId })
                    const pages = await Promise.all(candidates.map((source) => reader.read(source)))
                    const read = pages.filter((page): page is WebSearchResult => !!page)
                    if (read.length) {
                      // Both versions remain available for exact excerpt validation.
                      missingQuestions = validated.readRequests
                        .map((request) => request.question)
                        .join('\n')
                      results = [...results, ...read]
                      progress({
                        type: 'search_complete',
                        results: sourceMetadata(results),
                        limitations,
                        nodeId: searchQuery.nodeId,
                      })
                      continue
                    }
                  }
                }
                const needsRepair =
                  !checked.learnings.length &&
                  (assessment.reason === 'unmatched_quotes' ||
                    assessment.reason === 'unmatched_sources')
                if (!needsRepair || extractionRetried) break
                extractionRetried = true
              }
              if (searchResult.learnings?.length || attempt === 2) break
              if (attempt === 0) {
                plan = await planFallbackSearch()
                continue
              }
              const rewrite = searchResult.rewriteQuery?.trim()
              if (
                !rewrite ||
                rewrite.toLowerCase().replace(/\s+/g, ' ') ===
                  plan.query.toLowerCase().replace(/\s+/g, ' ')
              )
                break
              // The extractor can change only query text. All filters remain frozen.
              plan = { ...plan, query: rewrite }
            }
            if (!searchResult.learnings?.length) {
              progress({ type: 'no_evidence', assessment: assessment!, nodeId: searchQuery.nodeId })
              return { learnings: learnings ?? [] }
            }
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
                  searchConstraints: plan,
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
                  sourceReader: reader,
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
            if (nodeLearnings.length)
              progress({
                type: 'node_complete',
                result: { learnings: nodeLearnings, followUpQuestions: [] },
                nodeId: searchQuery.nodeId,
              })
            console.error(`Error in node ${searchQuery.nodeId} for query ${searchQuery.query}`, e)
            progress({
              type: 'error',
              message: e.message,
              nodeId: searchQuery.nodeId,
            })
            return {
              learnings: nodeLearnings,
            }
          }
        }),
      ),
    )
    throwIfAborted(signal)
    const finalLearnings = deduplicateLearnings([
      ...(learnings ?? []),
      ...results.flatMap((result) => result.learnings),
    ])
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
      learnings: learnings ?? [],
    }
  }
}

/** Requested search snippets that have not already been read as full pages. */
function selectReadCandidates(
  requests: NonNullable<ProcessedSearchResult['readRequests']>,
  results: WebSearchResult[],
) {
  return [...new Set(requests.map((request) => request.sourceId))]
    .map((id) => results[id])
    .filter(
      (source): source is WebSearchResult =>
        !!source &&
        source.sourceType !== 'page' &&
        !results.some((page) => page.url === source.url && page.sourceType === 'page'),
    )
    .slice(0, sourceReadLimits.perNode)
}

/** The UI/history only need unique source metadata, never full page bodies. */
function sourceMetadata(results: WebSearchResult[]): WebSearchResult[] {
  const sources = new Map<string, WebSearchResult>()
  for (const { content: _content, ...source } of results) {
    sources.set(source.url, { ...sources.get(source.url), ...source, content: '' })
  }
  return [...sources.values()]
}
