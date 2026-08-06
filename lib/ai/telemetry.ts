import type { TelemetrySettings } from 'ai'

export function isAgentPondTracingEnabled() {
  return typeof process !== 'undefined' && process.env.AGENTPOND_TRACING_ENABLED === 'true'
}

export function agentPondTelemetry(functionId: string): TelemetrySettings {
  return {
    isEnabled: isAgentPondTracingEnabled(),
    functionId,
    recordInputs: false,
    recordOutputs: false,
  }
}
