import type { SearchConstraints } from '~~/shared/utils/search-plan'
import { deepResearch as clientDeepResearch } from '~~/lib/core/deep-research'
import { generateFeedback as clientGenerateFeedback } from '~~/lib/core/feedback'
import { writeFinalReport as clientWriteFinalReport } from '~~/lib/core/report'
import type { ResearchStep } from '~~/lib/core/deep-research'
import { OperationTimeoutError } from '~~/shared/utils/abort'
import { parseSSEStream } from '~/utils/sse'
import type { ResearchLearning } from '~~/shared/types/research-session'
import type { WriteFinalReportParams } from '~~/lib/core/report'

function throwIfTimeoutFrame(value: unknown) {
  if (!value || typeof value !== 'object') return
  const frame = value as { type?: unknown; code?: unknown; message?: unknown; error?: unknown }
  if (frame.type !== 'error' || frame.code !== 'timeout') return

  const message = typeof frame.message === 'string' ? frame.message : frame.error
  throw new OperationTimeoutError(
    typeof message === 'string' ? message : 'The operation timed out.',
  )
}

async function* parseServerOperationStream(response: Response) {
  for await (const value of parseSSEStream(response)) {
    throwIfTimeoutFrame(value)
    yield value
  }
}

export function useServerMode() {
  const runtimeConfig = useRuntimeConfig()
  const isServerMode = computed(() => runtimeConfig.public.serverMode)
  const access = useAccessPassword()
  const { t } = useI18n()

  async function postOperation(url: string, body: unknown, signal?: AbortSignal) {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...access.headers(),
      },
      body: JSON.stringify(body),
      signal,
    })
    if (response.status === 401) {
      await response.body?.cancel().catch(() => {})
      access.promptOpen.value = true
      throw new AccessDeniedError(t('accessPassword.denied'))
    }
    return parseServerOperationStream(response)
  }

  // Server-side implementations
  const serverDeepResearch = async (params: {
    query: string
    originalQuery?: string
    breadth: number
    maxDepth: number
    languageCode: Locale
    searchLanguageCode?: Locale
    sourceUrls?: string[]
    searchConstraints?: SearchConstraints
    learnings?: ResearchLearning[]
    currentDepth: number
    nodeId?: string
    retryNode?: any
    onProgress: (step: ResearchStep) => void
    signal?: AbortSignal
  }) => {
    const {
      query,
      originalQuery,
      breadth,
      maxDepth,
      languageCode,
      searchLanguageCode,
      searchConstraints,
      sourceUrls,
      learnings,
      currentDepth,
      nodeId,
      retryNode,
      onProgress,
      signal,
    } = params

    const stream = await postOperation(
      '/api/research',
      {
        query,
        originalQuery,
        breadth,
        depth: maxDepth,
        languageCode,
        searchLanguageCode,
        searchConstraints,
        sourceUrls,
        learnings,
        currentDepth,
        nodeId,
        retryNode,
      },
      signal,
    )

    for await (const step of stream) {
      onProgress(step)
    }
  }

  const serverGenerateFeedback = async function* (params: {
    query: string
    language: string
    numQuestions: number
    suggestResearchMode?: boolean
    aiConfig: ConfigAi
    signal?: AbortSignal
  }) {
    const { query, language, numQuestions, suggestResearchMode, signal } = params

    const stream = await postOperation(
      '/api/feedback',
      { query, language, numQuestions, suggestResearchMode },
      signal,
    )

    for await (const step of stream) {
      yield step
    }
  }

  const serverWriteFinalReport = async (params: WriteFinalReportParams) => {
    const { prompt, learnings, language, signal, revision } = params

    return {
      fullStream: await postOperation(
        '/api/report',
        { prompt, learnings, language, revision },
        signal,
      ),
    }
  }

  return {
    isServerMode,
    deepResearch: isServerMode.value
      ? serverDeepResearch
      : (params: {
          query: string
          originalQuery?: string
          breadth: number
          maxDepth: number
          languageCode: Locale
          aiConfig: ConfigAi
          searchLanguageCode?: Locale
          sourceUrls?: string[]
          searchConstraints?: SearchConstraints
          learnings?: ResearchLearning[]
          currentDepth: number
          nodeId?: string
          retryNode?: any
          onProgress: (step: ResearchStep) => void
          signal?: AbortSignal
        }) =>
          clientDeepResearch({
            ...params,
            webSearchFunction: useWebSearch(),
            pLimitInstance: usePLimit(),
          }),
    generateFeedback: isServerMode.value ? serverGenerateFeedback : clientGenerateFeedback,
    writeFinalReport: isServerMode.value ? serverWriteFinalReport : clientWriteFinalReport,
  }
}
