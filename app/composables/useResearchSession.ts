import { computed, readonly, shallowRef } from 'vue'
import type { ResearchHistoryItem } from '~/types/history'
import type {
  ResearchFailure,
  ResearchFeedbackResult,
  ResearchFeedbackSnapshot,
  ResearchInputData,
  ResearchInputSnapshot,
  ResearchOperationLease,
  ResearchPhase,
  ResearchResult,
  ResearchSession,
} from '~~/shared/types/research-session'

export type ResearchSessionEvent =
  | {
      type: 'BEGIN_FEEDBACK'
      sessionId: string
      operationId: string
      input: ResearchInputData
      at: string
    }
  | {
      type: 'FEEDBACK_SUCCEEDED'
      sessionId: string
      operationId: string
      feedback: ResearchFeedbackResult[]
      at: string
    }
  | {
      type: 'BEGIN_RESEARCH'
      sessionId: string
      operationId: string
      feedback: ResearchFeedbackResult[]
      at: string
    }
  | {
      type: 'BEGIN_RESEARCH_RETRY'
      sessionId: string
      operationId: string
      at: string
    }
  | {
      type: 'RESEARCH_SUCCEEDED'
      sessionId: string
      operationId: string
      nextOperationId: string
      historyId: string
      result: ResearchResult
      at: string
    }
  | {
      type: 'RESEARCH_RETRY_FAILED'
      sessionId: string
      operationId: string
      fallbackStatus: 'completed' | 'failed'
      fallbackPhase?: ResearchPhase
      fallbackFailure?: ResearchFailure
      at: string
    }
  | {
      type: 'BEGIN_REPORT'
      sessionId: string
      operationId: string
      at: string
    }
  | {
      type: 'REPORT_SUCCEEDED'
      sessionId: string
      operationId: string
      report: string
      at: string
    }
  | {
      type: 'OPERATION_FAILED'
      sessionId: string
      operationId: string
      failure: ResearchFailure
      at: string
    }
  | {
      type: 'CANCEL_REQUESTED'
      sessionId: string
      operationId: string
      at: string
    }
  | {
      type: 'OPERATION_CANCELLED'
      sessionId: string
      operationId: string
      at: string
    }
  | {
      type: 'OPERATION_TIMED_OUT'
      sessionId: string
      operationId: string
      phase: ResearchPhase
      at: string
    }
  | { type: 'LOAD_HISTORY'; sessionId: string; item: ResearchHistoryItem; at: string }

export function createInitialResearchSession(): ResearchSession {
  return {
    id: '',
    revision: 0,
    status: 'idle',
    result: { learnings: [] },
    report: '',
  }
}

function snapshotInput(input: ResearchInputData): ResearchInputSnapshot {
  return Object.freeze({
    query: input.query,
    breadth: input.breadth,
    depth: input.depth,
    numQuestions: input.numQuestions,
  })
}

function snapshotFeedback(
  feedback: ResearchFeedbackResult[],
): ReadonlyArray<ResearchFeedbackSnapshot> {
  return Object.freeze(
    feedback.map((item) =>
      Object.freeze({
        assistantQuestion: item.assistantQuestion,
        userAnswer: item.userAnswer,
      }),
    ),
  )
}

function snapshotResult(result: ResearchResult): ResearchResult {
  return {
    learnings: result.learnings.map((learning) => ({
      url: learning.url,
      title: learning.title,
      learning: learning.learning,
    })),
  }
}

function isRunningOperation(
  state: ResearchSession,
  event: { sessionId: string; operationId: string },
) {
  return (
    state.status === 'running' &&
    state.id === event.sessionId &&
    state.operationId === event.operationId
  )
}

function revise(
  state: ResearchSession,
  changes: Partial<ResearchSession>,
  updatedAt: string,
): ResearchSession {
  return {
    ...state,
    ...changes,
    revision: state.revision + 1,
    updatedAt,
  }
}

export function researchSessionReducer(
  state: ResearchSession,
  event: ResearchSessionEvent,
): ResearchSession {
  switch (event.type) {
    case 'BEGIN_FEEDBACK':
      if (!['idle', 'completed', 'failed', 'cancelled', 'timed-out'].includes(state.status)) {
        return state
      }
      return {
        id: event.sessionId,
        revision: state.revision + 1,
        operationId: event.operationId,
        status: 'running',
        phase: 'feedback',
        input: snapshotInput(event.input),
        feedback: [],
        result: { learnings: [] },
        report: '',
        createdAt: event.at,
        updatedAt: event.at,
      }

    case 'FEEDBACK_SUCCEEDED':
      if (!isRunningOperation(state, event) || state.phase !== 'feedback') return state
      return revise(
        state,
        {
          operationId: undefined,
          status: 'awaiting-input',
          feedback: snapshotFeedback(event.feedback),
          failure: undefined,
        },
        event.at,
      )

    case 'BEGIN_RESEARCH':
      if (state.id !== event.sessionId || state.status !== 'awaiting-input') return state
      return revise(
        state,
        {
          operationId: event.operationId,
          status: 'running',
          phase: 'research',
          feedback: snapshotFeedback(event.feedback),
          result: { learnings: [] },
          report: '',
          failure: undefined,
        },
        event.at,
      )

    case 'BEGIN_RESEARCH_RETRY':
      if (
        state.id !== event.sessionId ||
        !state.input ||
        !(
          state.status === 'completed' ||
          (state.status === 'failed' && (state.phase === 'research' || state.phase === 'report'))
        )
      ) {
        return state
      }
      return revise(
        state,
        {
          operationId: event.operationId,
          status: 'running',
          phase: 'research',
          failure: undefined,
        },
        event.at,
      )

    case 'RESEARCH_SUCCEEDED':
      if (!isRunningOperation(state, event) || state.phase !== 'research') return state
      return revise(
        state,
        {
          operationId: event.nextOperationId,
          historyId: event.historyId,
          status: 'running',
          phase: 'report',
          result: snapshotResult(event.result),
          report: '',
          failure: undefined,
        },
        event.at,
      )

    case 'RESEARCH_RETRY_FAILED':
      if (!isRunningOperation(state, event) || state.phase !== 'research') return state
      return revise(
        state,
        {
          operationId: undefined,
          status: event.fallbackStatus,
          phase: event.fallbackPhase,
          failure: event.fallbackFailure,
        },
        event.at,
      )

    case 'BEGIN_REPORT':
      if (
        state.id !== event.sessionId ||
        !state.input ||
        !state.historyId ||
        !(state.status === 'completed' || (state.status === 'failed' && state.phase === 'report'))
      ) {
        return state
      }
      return revise(
        state,
        {
          operationId: event.operationId,
          status: 'running',
          phase: 'report',
          failure: undefined,
        },
        event.at,
      )

    case 'REPORT_SUCCEEDED':
      if (!isRunningOperation(state, event) || state.phase !== 'report') return state
      return revise(
        state,
        {
          operationId: undefined,
          status: 'completed',
          report: event.report,
          failure: undefined,
        },
        event.at,
      )

    case 'OPERATION_FAILED':
      if (!isRunningOperation(state, event)) return state
      return revise(
        state,
        {
          operationId: undefined,
          status: 'failed',
          phase: event.failure.phase,
          failure: event.failure,
        },
        event.at,
      )

    case 'CANCEL_REQUESTED':
      if (!isRunningOperation(state, event)) return state
      return revise(state, { status: 'cancelling' }, event.at)

    case 'OPERATION_CANCELLED':
      if (
        state.status !== 'cancelling' ||
        state.id !== event.sessionId ||
        state.operationId !== event.operationId
      ) {
        return state
      }
      return revise(
        state,
        { operationId: undefined, status: 'cancelled', failure: undefined },
        event.at,
      )

    case 'OPERATION_TIMED_OUT':
      if (!isRunningOperation(state, event)) return state
      return revise(
        state,
        {
          operationId: undefined,
          status: 'timed-out',
          phase: event.phase,
          failure: {
            phase: event.phase,
            code: 'upstream',
            message: 'The operation timed out.',
            retryable: true,
          },
        },
        event.at,
      )

    case 'LOAD_HISTORY':
      if (state.status === 'running' || state.status === 'cancelling') return state
      return {
        id: event.sessionId,
        revision: state.revision + 1,
        historyId: event.item.id,
        status: 'completed',
        input: snapshotInput(event.item),
        feedback: snapshotFeedback(event.item.feedback),
        result: snapshotResult({ learnings: event.item.learnings }),
        report: event.item.report || '',
        createdAt: event.item.createdAt,
        updatedAt: event.at,
      }
  }
}

interface UseResearchSessionOptions {
  createId?: () => string
  now?: () => string
}

export interface ResearchRetryLease extends ResearchOperationLease {
  fallbackStatus: 'completed' | 'failed'
  fallbackPhase?: ResearchPhase
  fallbackFailure?: ResearchFailure
}

export function useResearchSession(options: UseResearchSessionOptions = {}) {
  const createId = options.createId ?? (() => crypto.randomUUID())
  const now = options.now ?? (() => new Date().toISOString())
  const state = shallowRef(createInitialResearchSession())

  const isRunning = computed(
    () => state.value.status === 'running' || state.value.status === 'cancelling',
  )

  function commit(event: ResearchSessionEvent) {
    state.value = researchSessionReducer(state.value, event)
  }

  function currentLease(): ResearchOperationLease | undefined {
    const session = state.value
    if (!session.operationId || !session.input) return
    return {
      sessionId: session.id,
      operationId: session.operationId,
      input: session.input,
      feedback: session.feedback ?? [],
      result: snapshotResult(session.result),
    }
  }

  function beginFeedback(input: ResearchInputData) {
    const operationId = createId()
    commit({
      type: 'BEGIN_FEEDBACK',
      sessionId: createId(),
      operationId,
      input,
      at: now(),
    })
    return state.value.operationId === operationId ? currentLease() : undefined
  }

  function completeFeedback(lease: ResearchOperationLease, feedback: ResearchFeedbackResult[]) {
    commit({
      type: 'FEEDBACK_SUCCEEDED',
      sessionId: lease.sessionId,
      operationId: lease.operationId,
      feedback,
      at: now(),
    })
  }

  function beginResearch(feedback: ResearchFeedbackResult[]) {
    const previous = state.value
    const operationId = createId()
    commit({
      type: 'BEGIN_RESEARCH',
      sessionId: previous.id,
      operationId,
      feedback,
      at: now(),
    })
    return state.value.operationId === operationId ? currentLease() : undefined
  }

  function beginResearchRetry() {
    const previous = state.value
    const operationId = createId()
    commit({
      type: 'BEGIN_RESEARCH_RETRY',
      sessionId: previous.id,
      operationId,
      at: now(),
    })
    const lease = state.value.operationId === operationId ? currentLease() : undefined
    if (!lease) return
    return {
      ...lease,
      fallbackStatus: previous.status === 'completed' ? 'completed' : 'failed',
      fallbackPhase: previous.phase,
      fallbackFailure: previous.failure,
    } satisfies ResearchRetryLease
  }

  function failResearchRetry(lease: ResearchRetryLease) {
    commit({
      type: 'RESEARCH_RETRY_FAILED',
      sessionId: lease.sessionId,
      operationId: lease.operationId,
      fallbackStatus: lease.fallbackStatus,
      fallbackPhase: lease.fallbackPhase,
      fallbackFailure: lease.fallbackFailure,
      at: now(),
    })
  }

  function completeResearch(
    lease: ResearchOperationLease,
    result: ResearchResult,
    historyId: string,
  ) {
    const nextOperationId = createId()
    commit({
      type: 'RESEARCH_SUCCEEDED',
      sessionId: lease.sessionId,
      operationId: lease.operationId,
      nextOperationId,
      historyId,
      result,
      at: now(),
    })
    return state.value.operationId === nextOperationId ? currentLease() : undefined
  }

  function beginReport() {
    const previous = state.value
    const operationId = createId()
    commit({
      type: 'BEGIN_REPORT',
      sessionId: previous.id,
      operationId,
      at: now(),
    })
    return state.value.operationId === operationId ? currentLease() : undefined
  }

  function completeReport(lease: ResearchOperationLease, report: string) {
    commit({
      type: 'REPORT_SUCCEEDED',
      sessionId: lease.sessionId,
      operationId: lease.operationId,
      report,
      at: now(),
    })
  }

  function failOperation(lease: ResearchOperationLease, failure: ResearchFailure) {
    commit({
      type: 'OPERATION_FAILED',
      sessionId: lease.sessionId,
      operationId: lease.operationId,
      failure,
      at: now(),
    })
  }

  function loadHistory(item: ResearchHistoryItem) {
    const revision = state.value.revision
    commit({ type: 'LOAD_HISTORY', sessionId: createId(), item, at: now() })
    return state.value.revision !== revision
  }

  function isCurrentOperation(sessionId: string, operationId: string) {
    return (
      state.value.status === 'running' &&
      state.value.id === sessionId &&
      state.value.operationId === operationId
    )
  }

  return {
    state: readonly(state),
    isRunning,
    beginFeedback,
    completeFeedback,
    beginResearch,
    beginResearchRetry,
    failResearchRetry,
    completeResearch,
    beginReport,
    completeReport,
    failOperation,
    loadHistory,
    isCurrentOperation,
  }
}
