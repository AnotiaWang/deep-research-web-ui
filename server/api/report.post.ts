import { writeFinalReport } from '~~/lib/core/report'
import type { ConfigAi } from '~~/shared/types/config'
import { getStreamErrorMessage } from '~~/shared/utils/stream-error'
import { z } from 'zod'
import { researchLearningSchema } from '~~/shared/utils/research-learning'
import { reportRevisionSchema } from '~~/shared/utils/report-revision'
import { getServerProxyFetch, proxyEnvFromRuntimeConfig } from '~~/server/utils/proxy'

export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig()
  const body = await readBody(event)

  const parsed = z
    .object({
      prompt: z.string().min(1),
      learnings: z.array(researchLearningSchema).min(1),
      language: z.string().min(1),
      revision: reportRevisionSchema.optional(),
    })
    .safeParse(body)
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid report parameters',
    })
  }
  const { prompt, learnings, language, revision } = parsed.data

  // Create server-side configuration
  const serverConfig: ConfigAi = {
    provider: runtimeConfig.public.aiProvider as ConfigAi['provider'],
    apiKey: runtimeConfig.aiApiKey,
    apiBase: runtimeConfig.aiApiBase,
    model: runtimeConfig.public.aiModel,
    contextSize: runtimeConfig.public.aiContextSize,
    maxOutputTokens: runtimeConfig.public.aiMaxOutputTokens || undefined,
    fetch: getServerProxyFetch(proxyEnvFromRuntimeConfig(runtimeConfig)),
  }

  // Set response headers for streaming
  setHeader(event, 'Content-Type', 'text/event-stream')
  setHeader(event, 'Cache-Control', 'no-cache')
  setHeader(event, 'Connection', 'keep-alive')

  const requestAbort = createRequestAbort(
    event,
    serverOperationTimeout(runtimeConfig.public.researchReportTimeoutMs),
  )

  const stream = new ReadableStream({
    async start(controller) {
      const writer = createSSEWriter(controller, requestAbort.canWrite)

      try {
        const reportGenerator = writeFinalReport({
          prompt,
          learnings,
          language,
          aiConfig: serverConfig,
          signal: requestAbort.signal,
          revision,
        })

        for await (const chunk of reportGenerator.fullStream) {
          if (requestAbort.signal.aborted) break
          const serializableChunk =
            chunk.type === 'error' ? { type: 'error', error: getStreamErrorMessage(chunk) } : chunk
          writer.write(serializableChunk)
        }
      } catch (error: any) {
        if (!requestAbort.signal.aborted) {
          writer.write({ type: 'error', error: getStreamErrorMessage({ error }) })
        }
      } finally {
        if (requestAbort.reason() === 'timeout') {
          writer.write({
            type: 'error',
            code: 'timeout',
            error: 'The report request timed out.',
          })
        }
        requestAbort.cleanup()
        writer.close()
      }
    },
    cancel() {
      requestAbort.abort('stream-cancel')
    },
  })

  return sendStream(event, stream)
})
