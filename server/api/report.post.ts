import { writeFinalReport } from '~~/lib/core/report'
import type { ConfigAi } from '~~/shared/types/config'
import { getStreamErrorMessage } from '~~/shared/utils/stream-error'
import { z } from 'zod'
import { researchLearningSchema } from '~~/shared/utils/research-learning'
import { researchInputLimits, researchRequestLimits } from '~~/shared/utils/research-input'
import { reportRevisionSchema } from '~~/shared/utils/report-revision'
import { getServerProxyFetch, proxyEnvFromRuntimeConfig } from '~~/server/utils/proxy'
import { assertAccessAuthorized } from '~~/server/utils/access'
import { REQUEST_BODY_LIMITS, readApiBody } from '~~/server/utils/request-body'

export default defineEventHandler(async (event) => {
  // This route spends the server's AI key, so it does not rely on the path-based middleware alone
  assertAccessAuthorized(event)
  const runtimeConfig = useRuntimeConfig()

  const body = await readApiBody(event, REQUEST_BODY_LIMITS['/api/report'])

  const parsed = z
    .object({
      // Bounded: every learning is tokenized synchronously before the report call starts.
      prompt: z.string().min(1).max(researchRequestLimits.originalQuery),
      // 500 is well past what the research flow accumulates; the byte cap above is the real limit.
      learnings: z.array(researchLearningSchema).min(1).max(researchInputLimits.learnings),
      language: z.string().min(1).max(researchRequestLimits.language),
      revision: reportRevisionSchema.optional(),
    })
    .strict()
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
