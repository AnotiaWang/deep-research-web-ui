import { computed, readonly, shallowRef } from 'vue'
import type { ResearchHistoryItem } from '~/types/history'
import { createRuntimeId } from '~~/shared/utils/id'
import type {
  ResearchFailure,
  ResearchFeedbackResult,
  ResearchInputData,
  ResearchOperationLease,
  ResearchPhase,
  ResearchResult,
} from '~~/shared/types/research-session'
import type { ResearchDepthSettings } from '~~/shared/utils/research-input'
import {
  canBeginFeedbackFromSession,
  canRegenerateReportFromSession,
  canRetryResearchFromSession,
  createInitialResearchSession,
  researchSessionReducer,
  snapshotResult,
  type ResearchRetryFallbackStatus,
  type ResearchSessionEvent,
} from '~/utils/research-session-reducer'
interface UseResearchSessionOptions {
  createId?: () => string
  now?: () => string
}

export interface ResearchRetryLease extends ResearchOperationLease {
  fallbackStatus: ResearchRetryFallbackStatus
  fallbackPhase?: ResearchPhase
  fallbackFailure?: ResearchFailure
}

export function useResearchSession(options: UseResearchSessionOptions = {}) {
  const createId = options.createId ?? createRuntimeId
  const now = options.now ?? (() => new Date().toISOString())
  const state = shallowRef(createInitialResearchSession())

  const isRunning = computed(
    () => state.value.status === 'running' || state.value.status === 'cancelling',
  )
  const canBeginFeedback = computed(() => canBeginFeedbackFromSession(state.value))
  const canRetryResearch = computed(() => canRetryResearchFromSession(state.value))
  const canRegenerateReport = computed(() => canRegenerateReportFromSession(state.value))

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

  function beginResearch(feedback: ResearchFeedbackResult[], settings?: ResearchDepthSettings) {
    const previous = state.value
    const operationId = createId()
    commit({
      type: 'BEGIN_RESEARCH',
      sessionId: previous.id,
      operationId,
      feedback,
      settings,
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
      fallbackStatus: previous.status as ResearchRetryFallbackStatus,
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

  function completeRefinement(
    lease: ResearchOperationLease,
    result: ResearchResult,
    report: string,
    historyId: string,
  ) {
    commit({
      type: 'REFINEMENT_SUCCEEDED',
      sessionId: lease.sessionId,
      operationId: lease.operationId,
      result,
      report,
      historyId,
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

  function requestCancellation(lease: ResearchOperationLease) {
    const revision = state.value.revision
    commit({
      type: 'CANCEL_REQUESTED',
      sessionId: lease.sessionId,
      operationId: lease.operationId,
      at: now(),
    })
    return state.value.revision !== revision && state.value.status === 'cancelling'
  }

  function completeCancellation(lease: ResearchOperationLease) {
    const revision = state.value.revision
    commit({
      type: 'OPERATION_CANCELLED',
      sessionId: lease.sessionId,
      operationId: lease.operationId,
      at: now(),
    })
    return state.value.revision !== revision && state.value.status === 'cancelled'
  }

  function timeoutOperation(lease: ResearchOperationLease, phase: ResearchPhase, message?: string) {
    const revision = state.value.revision
    commit({
      type: 'OPERATION_TIMED_OUT',
      sessionId: lease.sessionId,
      operationId: lease.operationId,
      phase,
      message,
      at: now(),
    })
    return state.value.revision !== revision && state.value.status === 'timed-out'
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
    canBeginFeedback,
    canRetryResearch,
    canRegenerateReport,
    beginFeedback,
    completeFeedback,
    beginResearch,
    beginResearchRetry,
    failResearchRetry,
    completeResearch,
    beginReport,
    completeReport,
    completeRefinement,
    failOperation,
    requestCancellation,
    completeCancellation,
    timeoutOperation,
    loadHistory,
    isCurrentOperation,
  }
}
