import { createFilesSpanExporterFromRuntimeEnv } from '@agentpond/files-sdk/otel'
import { isOpenInferenceSpan, OpenInferenceBatchSpanProcessor } from '@arizeai/openinference-vercel'
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
import { isAgentPondTracingEnabled } from '~~/lib/ai/telemetry'

export default defineNitroPlugin((nitroApp) => {
  if (!isAgentPondTracingEnabled()) return

  if (!process.env.FILES_SDK_PROVIDER) {
    console.warn(
      '[AgentPond] Tracing is enabled, but no Files SDK environment is loaded; tracing will remain inactive.',
    )
    return
  }

  const provider = new NodeTracerProvider({
    spanProcessors: [
      new OpenInferenceBatchSpanProcessor({
        exporter: createFilesSpanExporterFromRuntimeEnv(),
        spanFilter: isOpenInferenceSpan,
        reparentOrphanedSpans: true,
      }),
    ],
  })

  provider.register()

  nitroApp.hooks.hook('close', async () => {
    await provider.shutdown()
  })
})
