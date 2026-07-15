import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  createInitialResearchSession,
  researchSessionReducer,
} from '../app/composables/useResearchSession.ts'

const at = '2026-07-15T00:00:00.000Z'

describe('research session reducer', () => {
  it('freezes the input used by an active session', () => {
    const draft = { query: 'first', breadth: 2, depth: 3, numQuestions: 2 }
    const session = researchSessionReducer(createInitialResearchSession(), {
      type: 'BEGIN_FEEDBACK',
      sessionId: 'session-1',
      operationId: 'operation-1',
      input: draft,
      at,
    })

    draft.query = 'edited later'

    assert.equal(session.input?.query, 'first')
    assert.equal(Object.isFrozen(session.input), true)
  })

  it('ignores completion from an obsolete operation', () => {
    const first = researchSessionReducer(createInitialResearchSession(), {
      type: 'BEGIN_FEEDBACK',
      sessionId: 'session-1',
      operationId: 'operation-1',
      input: { query: 'first', breadth: 2, depth: 2, numQuestions: 3 },
      at,
    })
    const failed = researchSessionReducer(first, {
      type: 'OPERATION_FAILED',
      sessionId: 'session-1',
      operationId: 'operation-1',
      failure: {
        phase: 'feedback',
        code: 'network',
        message: 'offline',
        retryable: true,
      },
      at,
    })
    const second = researchSessionReducer(failed, {
      type: 'BEGIN_FEEDBACK',
      sessionId: 'session-2',
      operationId: 'operation-2',
      input: { query: 'second', breadth: 2, depth: 2, numQuestions: 3 },
      at,
    })
    const staleCompletion = researchSessionReducer(second, {
      type: 'FEEDBACK_SUCCEEDED',
      sessionId: 'session-1',
      operationId: 'operation-1',
      feedback: [{ assistantQuestion: 'Old question', userAnswer: '' }],
      at,
    })

    assert.equal(staleCompletion, second)
    assert.equal(staleCompletion.input?.query, 'second')
    assert.equal(staleCompletion.status, 'running')
  })

  it('keeps terminal outcomes mutually exclusive', () => {
    const running = researchSessionReducer(createInitialResearchSession(), {
      type: 'BEGIN_FEEDBACK',
      sessionId: 'session-1',
      operationId: 'operation-1',
      input: { query: 'topic', breadth: 2, depth: 2, numQuestions: 3 },
      at,
    })
    const failed = researchSessionReducer(running, {
      type: 'OPERATION_FAILED',
      sessionId: 'session-1',
      operationId: 'operation-1',
      failure: {
        phase: 'feedback',
        code: 'network',
        message: 'offline',
        retryable: true,
      },
      at,
    })
    const lateSuccess = researchSessionReducer(failed, {
      type: 'FEEDBACK_SUCCEEDED',
      sessionId: 'session-1',
      operationId: 'operation-1',
      feedback: [{ assistantQuestion: 'Question', userAnswer: '' }],
      at,
    })

    assert.equal(lateSuccess, failed)
    assert.equal(lateSuccess.status, 'failed')
  })

  it('rejects history loading while an operation is running', () => {
    const running = researchSessionReducer(createInitialResearchSession(), {
      type: 'BEGIN_FEEDBACK',
      sessionId: 'active-session',
      operationId: 'active-operation',
      input: { query: 'active', breadth: 2, depth: 2, numQuestions: 3 },
      at,
    })
    const attemptedLoad = researchSessionReducer(running, {
      type: 'LOAD_HISTORY',
      sessionId: 'loaded-session',
      at,
      item: {
        id: 'history-without-report',
        title: 'Loaded',
        query: 'loaded',
        breadth: 3,
        depth: 4,
        numQuestions: 2,
        feedback: [],
        learnings: [{ url: 'https://example.com', learning: 'Loaded result' }],
        report: '',
        createdAt: at,
        updatedAt: at,
      },
    })
    assert.equal(attemptedLoad, running)
  })

  it('replaces report and history identity when loading history from a terminal state', () => {
    const failed = {
      ...createInitialResearchSession(),
      id: 'old-session',
      status: 'failed' as const,
      phase: 'feedback' as const,
      report: 'Old report',
    }
    const loaded = researchSessionReducer(failed, {
      type: 'LOAD_HISTORY',
      sessionId: 'loaded-session',
      at,
      item: {
        id: 'history-without-report',
        title: 'Loaded',
        query: 'loaded',
        breadth: 3,
        depth: 4,
        numQuestions: 2,
        feedback: [],
        learnings: [{ url: 'https://example.com', learning: 'Loaded result' }],
        report: '',
        createdAt: at,
        updatedAt: at,
      },
    })
    const staleCompletion = researchSessionReducer(loaded, {
      type: 'FEEDBACK_SUCCEEDED',
      sessionId: 'active-session',
      operationId: 'active-operation',
      feedback: [{ assistantQuestion: 'Old question', userAnswer: '' }],
      at,
    })

    assert.equal(loaded.status, 'completed')
    assert.equal(loaded.historyId, 'history-without-report')
    assert.equal(loaded.report, '')
    assert.equal(loaded.input?.query, 'loaded')
    assert.equal(staleCompletion, loaded)
  })

  it('leases a node retry to its existing history item', () => {
    const completed = {
      ...createInitialResearchSession(),
      id: 'session-1',
      historyId: 'history-1',
      status: 'completed' as const,
      input: { query: 'topic', breadth: 2, depth: 2, numQuestions: 3 },
      result: {
        learnings: [{ url: 'https://example.com', learning: 'Old result' }],
      },
      report: 'Old report',
    }
    const retrying = researchSessionReducer(completed, {
      type: 'BEGIN_RESEARCH_RETRY',
      sessionId: 'session-1',
      operationId: 'retry-1',
      at,
    })

    assert.equal(retrying.status, 'running')
    assert.equal(retrying.phase, 'research')
    assert.equal(retrying.operationId, 'retry-1')
    assert.equal(retrying.historyId, 'history-1')
    assert.equal(retrying.report, 'Old report')
  })

  it('restores the previous terminal state when a node retry fails', () => {
    const retrying = {
      ...createInitialResearchSession(),
      id: 'session-1',
      historyId: 'history-1',
      operationId: 'retry-1',
      status: 'running' as const,
      phase: 'research' as const,
      input: { query: 'topic', breadth: 2, depth: 2, numQuestions: 3 },
      result: {
        learnings: [{ url: 'https://example.com', learning: 'Old result' }],
      },
      report: 'Old report',
    }
    const restored = researchSessionReducer(retrying, {
      type: 'RESEARCH_RETRY_FAILED',
      sessionId: 'session-1',
      operationId: 'retry-1',
      fallbackStatus: 'completed',
      fallbackPhase: 'report',
      at,
    })

    assert.equal(restored.status, 'completed')
    assert.equal(restored.phase, 'report')
    assert.equal(restored.operationId, undefined)
    assert.equal(restored.report, 'Old report')
    assert.equal(restored.failure, undefined)
  })

  it('preserves the previous report and rejects stale report completion', () => {
    const completed = {
      ...createInitialResearchSession(),
      id: 'session-1',
      historyId: 'history-1',
      status: 'completed' as const,
      phase: 'report' as const,
      input: { query: 'topic', breadth: 2, depth: 2, numQuestions: 3 },
      result: {
        learnings: [{ url: 'https://example.com', learning: 'Result' }],
      },
      report: 'Previous report',
    }
    const firstRun = researchSessionReducer(completed, {
      type: 'BEGIN_REPORT',
      sessionId: 'session-1',
      operationId: 'report-1',
      at,
    })
    const firstFailure = researchSessionReducer(firstRun, {
      type: 'OPERATION_FAILED',
      sessionId: 'session-1',
      operationId: 'report-1',
      failure: {
        phase: 'report',
        code: 'upstream',
        message: 'failed',
        retryable: true,
      },
      at,
    })
    const secondRun = researchSessionReducer(firstFailure, {
      type: 'BEGIN_REPORT',
      sessionId: 'session-1',
      operationId: 'report-2',
      at,
    })
    const staleCompletion = researchSessionReducer(secondRun, {
      type: 'REPORT_SUCCEEDED',
      sessionId: 'session-1',
      operationId: 'report-1',
      report: 'Stale report',
      at,
    })

    assert.equal(firstRun.report, 'Previous report')
    assert.equal(firstFailure.report, 'Previous report')
    assert.equal(staleCompletion, secondRun)
  })
})
