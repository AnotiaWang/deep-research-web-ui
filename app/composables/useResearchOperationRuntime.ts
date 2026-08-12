import { onScopeDispose } from 'vue'
import type { ResearchOperationLease, ResearchPhase } from '~~/shared/types/research-session'

type TimerHandle = ReturnType<typeof setTimeout>

interface ResearchOperationRuntimeOptions {
  timeouts: Record<ResearchPhase, number>
  onTimeout: (lease: ResearchOperationLease, phase: ResearchPhase) => void
  scheduleTimeout?: (callback: () => void, delay: number) => TimerHandle
  clearScheduledTimeout?: (handle: TimerHandle) => void
}

interface ActiveOperation {
  lease: ResearchOperationLease
  phase: ResearchPhase
  controller: AbortController
  timer: TimerHandle
}

export const defaultResearchOperationTimeouts: Record<ResearchPhase, number> = {
  feedback: 120_000,
  research: 900_000,
  report: 300_000,
}

export function useResearchOperationRuntime(options: ResearchOperationRuntimeOptions) {
  const scheduleTimeout =
    options.scheduleTimeout ?? ((callback, delay) => setTimeout(callback, delay))
  const clearScheduledTimeout = options.clearScheduledTimeout ?? clearTimeout
  let active: ActiveOperation | undefined

  function matches(lease: ResearchOperationLease) {
    return (
      active?.lease.sessionId === lease.sessionId && active.lease.operationId === lease.operationId
    )
  }

  function take(lease?: ResearchOperationLease) {
    if (!active || (lease && !matches(lease))) return
    const operation = active
    active = undefined
    clearScheduledTimeout(operation.timer)
    return operation
  }

  function start(lease: ResearchOperationLease, phase: ResearchPhase) {
    if (active) throw new Error('A research operation is already active.')

    const controller = new AbortController()
    const timeout = options.timeouts[phase]
    const timer = scheduleTimeout(() => {
      const operation = take(lease)
      if (!operation) return
      options.onTimeout(operation.lease, operation.phase)
      operation.controller.abort()
    }, timeout)

    active = { lease, phase, controller, timer }
    return controller.signal
  }

  function finish(lease: ResearchOperationLease) {
    return !!take(lease)
  }

  function cancel(lease: ResearchOperationLease) {
    const operation = take(lease)
    if (!operation) return false
    operation.controller.abort()
    return true
  }

  function currentLease() {
    return active?.lease
  }

  onScopeDispose(() => {
    const operation = take()
    operation?.controller.abort()
  }, true)

  return {
    start,
    finish,
    cancel,
    currentLease,
  }
}
