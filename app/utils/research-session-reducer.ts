import type { ResearchHistoryItem } from '~/types/history'
import type {
  ResearchFailure,
  ResearchFeedbackResult,
  ResearchFeedbackSnapshot,
  ResearchInputData,
  ResearchInputSnapshot,
  ResearchPhase,
  ResearchResult,
  ResearchSession,
} from '~~/shared/types/research-session'
import type { ResearchDepthSettings } from '~~/shared/utils/research-input'

/**
 * Pure state machine behind {@link useResearchSession}. Every transition is guarded
 * by session/operation IDs so late events from superseded operations are ignored.
 */
export type ResearchRetryFallbackStatus = 'completed' | 'failed' | 'cancelled' | 'timed-out'

export type ResearchSessionEvent =
  | {
      type: 'REFINEMENT_SUCCEEDED'
      sessionId: string
      operationId: string
      historyId: string
      result: ResearchResult
      report: string
      at: string
    }
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
      /** Breadth/depth confirmed after feedback; overrides the submitted form values */
      settings?: ResearchDepthSettings
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
      fallbackStatus: ResearchRetryFallbackStatus
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
      message?: string
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

export function canBeginFeedbackFromSession(state: Pick<ResearchSession, 'status'>) {
  return ['idle', 'completed', 'failed', 'cancelled', 'timed-out'].includes(state.status)
}

export function canRetryResearchFromSession(state: Pick<ResearchSession, 'status' | 'phase'>) {
  return (
    state.status === 'completed' ||
    (['failed', 'cancelled', 'timed-out'].includes(state.status) &&
      (state.phase === 'research' || state.phase === 'report'))
  )
}

export function canRegenerateReportFromSession(
  state: Pick<ResearchSession, 'status' | 'phase' | 'historyId' | 'input' | 'result'>,
) {
  return (
    !!state.input &&
    !!state.historyId &&
    state.result.learnings.length > 0 &&
    (state.status === 'completed' ||
      (['failed', 'cancelled', 'timed-out'].includes(state.status) &&
        (state.phase === 'report' || state.phase === 'research')))
  )
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

export function snapshotResult(result: ResearchResult): ResearchResult {
  return {
    learnings: result.learnings.map((learning) => ({
      ...learning,
      ...(learning.evidence ? { evidence: { ...learning.evidence } } : {}),
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
    case 'REFINEMENT_SUCCEEDED':
      if (!isRunningOperation(state, event) || state.phase !== 'research') return state
      return revise(
        state,
        {
          operationId: undefined,
          status: 'completed',
          phase: 'report',
          historyId: event.historyId,
          result: snapshotResult(event.result),
          report: event.report,
          failure: undefined,
        },
        event.at,
      )
    case 'BEGIN_FEEDBACK':
      if (!canBeginFeedbackFromSession(state)) {
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
          input:
            event.settings && state.input
              ? snapshotInput({ ...state.input, ...event.settings })
              : state.input,
          feedback: snapshotFeedback(event.feedback),
          result: { learnings: [] },
          report: '',
          failure: undefined,
        },
        event.at,
      )

    case 'BEGIN_RESEARCH_RETRY':
      if (state.id !== event.sessionId || !state.input || !canRetryResearchFromSession(state)) {
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
      if (state.id !== event.sessionId || !canRegenerateReportFromSession(state)) {
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
            message: event.message ?? 'The operation timed out.',
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
