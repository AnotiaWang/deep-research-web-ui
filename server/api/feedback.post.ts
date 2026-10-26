import { generateFeedback } from '~~/lib/core/feedback'
import type { ConfigAi } from '~~/shared/types/config'
import { feedbackRequestSchema } from '~~/shared/utils/research-input'
import { toClientErrorMessage } from '~~/shared/utils/redact'
import { getServerProxyFetch, proxyEnvFromRuntimeConfig } from '~~/server/utils/proxy'
import { assertAccessAuthorized } from '~~/server/utils/access'
import { REQUEST_BODY_LIMITS, readApiBody } from '~~/server/utils/request-body'

export default defineEventHandler(async (event) => {
  // This route spends the server's AI key, so it does not rely on the path-based middleware alone
  assertAccessAuthorized(event)
  const runtimeConfig = useRuntimeConfig()
  const body = await readApiBody(event, REQUEST_BODY_LIMITS['/api/feedback'])
  const parsedBody = feedbackRequestSchema.safeParse(body)
  if (!parsedBody.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid feedback request parameters',
      data: parsedBody.error.flatten(),
    })
  }
  const { query, language, numQuestions, suggestResearchMode } = parsedBody.data

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
    serverOperationTimeout(runtimeConfig.public.researchFeedbackTimeoutMs),
  )

  const stream = new ReadableStream({
    async start(controller) {
      const writer = createSSEWriter(controller, requestAbort.canWrite)

      try {
        const feedbackGenerator = generateFeedback({
          query,
          language,
          numQuestions,
          suggestResearchMode,
          aiConfig: serverConfig,
          signal: requestAbort.signal,
        })

        for await (const chunk of feedbackGenerator) {
          if (requestAbort.signal.aborted) break
          writer.write(chunk)
        }
      } catch (error: any) {
        if (!requestAbort.signal.aborted) {
          writer.write({ type: 'error', message: toClientErrorMessage(String(error?.message)) })
        }
      } finally {
        if (requestAbort.reason() === 'timeout') {
          writer.write({
            type: 'error',
            code: 'timeout',
            message: 'The feedback request timed out.',
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
