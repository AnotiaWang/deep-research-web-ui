import assert from 'node:assert/strict'
import test from 'node:test'

import { agentPondTelemetry } from './telemetry.ts'

test('AgentPond telemetry is private and disabled by default', () => {
  const previous = process.env.AGENTPOND_TRACING_ENABLED
  delete process.env.AGENTPOND_TRACING_ENABLED

  try {
    assert.deepEqual(agentPondTelemetry('test-operation'), {
      isEnabled: false,
      functionId: 'test-operation',
      recordInputs: false,
      recordOutputs: false,
    })
  } finally {
    if (previous === undefined) delete process.env.AGENTPOND_TRACING_ENABLED
    else process.env.AGENTPOND_TRACING_ENABLED = previous
  }
})

test('AgentPond telemetry requires explicit opt-in', () => {
  const previous = process.env.AGENTPOND_TRACING_ENABLED
  process.env.AGENTPOND_TRACING_ENABLED = 'true'

  try {
    assert.equal(agentPondTelemetry('test-operation').isEnabled, true)
  } finally {
    if (previous === undefined) delete process.env.AGENTPOND_TRACING_ENABLED
    else process.env.AGENTPOND_TRACING_ENABLED = previous
  }
})
