import { deepResearch as clientDeepResearch } from '~~/lib/core/deep-research'
import { generateFeedback as clientGenerateFeedback } from '~~/lib/core/feedback'
import { writeFinalReport as clientWriteFinalReport } from '~~/lib/core/deep-research'
import type { ResearchStep } from '~~/lib/core/deep-research'
import { OperationTimeoutError } from '~~/shared/utils/abort'
import { parseSSEStream } from '~/utils/sse'

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

  // Server-side implementations
  const serverDeepResearch = async (params: {
    query: string
    originalQuery?: string
    breadth: number
    maxDepth: number
    languageCode: Locale
    searchLanguageCode?: Locale
    learnings?: Array<{ url: string; learning: string }>
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
      learnings,
      currentDepth,
      nodeId,
      retryNode,
      onProgress,
      signal,
    } = params

    const response = await fetch('/api/research', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        originalQuery,
        breadth,
        depth: maxDepth,
        languageCode,
        searchLanguageCode,
        learnings,
        currentDepth,
        nodeId,
        retryNode,
      }),
      signal,
    })

    for await (const step of parseServerOperationStream(response)) {
      onProgress(step)
    }
  }

  const serverGenerateFeedback = async function* (params: {
    query: string
    language: string
    numQuestions: number
    aiConfig: ConfigAi
    signal?: AbortSignal
  }) {
    const { query, language, numQuestions, signal } = params

    const response = await fetch('/api/feedback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        language,
        numQuestions,
      }),
      signal,
    })

    for await (const step of parseServerOperationStream(response)) {
      yield step
    }
  }

  const serverWriteFinalReport = async (params: {
    prompt: string
    learnings: Array<{ url: string; learning: string }>
    language: string
    aiConfig: ConfigAi
    signal?: AbortSignal
  }) => {
    const { prompt, learnings, language, signal } = params

    const response = await fetch('/api/report', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        learnings,
        language,
      }),
      signal,
    })

    return {
      fullStream: parseServerOperationStream(response),
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
          learnings?: Array<{ url: string; learning: string }>
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
