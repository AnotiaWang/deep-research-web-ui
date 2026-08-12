import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { effectScope } from 'vue'
import { useResearchOperationRuntime } from '../app/composables/useResearchOperationRuntime.ts'
import type { ResearchOperationLease } from '../shared/types/research-session.ts'

const lease: ResearchOperationLease = {
  sessionId: 'session-1',
  operationId: 'operation-1',
  input: { query: 'topic', breadth: 2, depth: 2, numQuestions: 3 },
  feedback: [],
  result: { learnings: [] },
}

describe('research operation runtime', () => {
  it('aborts the active signal when the user cancels', () => {
    const scope = effectScope()
    let cleared = false
    const runtime = scope.run(() =>
      useResearchOperationRuntime({
        timeouts: { feedback: 100, research: 200, report: 300 },
        scheduleTimeout: () => ({}) as ReturnType<typeof setTimeout>,
        clearScheduledTimeout: () => {
          cleared = true
        },
        onTimeout: () => assert.fail('cancel must not be reported as a timeout'),
      }),
    )!

    const signal = runtime.start(lease, 'feedback')
    assert.equal(signal.aborted, false)
    assert.equal(runtime.cancel(lease), true)
    assert.equal(signal.aborted, true)
    assert.equal(cleared, true)
    assert.equal(runtime.currentLease(), undefined)
    scope.stop()
  })

  it('aborts and reports the leased phase when its deadline expires', () => {
    const scope = effectScope()
    let deadline: (() => void) | undefined
    let timedOutPhase = ''
    const runtime = scope.run(() =>
      useResearchOperationRuntime({
        timeouts: { feedback: 100, research: 200, report: 300 },
        scheduleTimeout: (callback) => {
          deadline = callback
          return {} as ReturnType<typeof setTimeout>
        },
        clearScheduledTimeout: () => {},
        onTimeout: (_lease, phase) => {
          timedOutPhase = phase
        },
      }),
    )!

    const signal = runtime.start(lease, 'research')
    deadline?.()

    assert.equal(signal.aborted, true)
    assert.equal(timedOutPhase, 'research')
    assert.equal(runtime.currentLease(), undefined)
    scope.stop()
  })
})
