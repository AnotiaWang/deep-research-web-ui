import { generateFeedback } from '~~/lib/core/feedback'
import type { ConfigAi } from '~~/shared/types/config'
import { feedbackRequestSchema } from '~~/shared/utils/research-input'

export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig()
  const parsedBody = feedbackRequestSchema.safeParse(await readBody(event))
  if (!parsedBody.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid feedback request parameters',
      data: parsedBody.error.flatten(),
    })
  }
  const { query, language, numQuestions } = parsedBody.data

  // Create server-side configuration
  const serverConfig: ConfigAi = {
    provider: runtimeConfig.public.aiProvider as ConfigAi['provider'],
    apiKey: runtimeConfig.aiApiKey,
    apiBase: runtimeConfig.aiApiBase,
    model: runtimeConfig.public.aiModel,
    contextSize: runtimeConfig.public.aiContextSize,
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
          aiConfig: serverConfig,
          signal: requestAbort.signal,
        })

        for await (const chunk of feedbackGenerator) {
          if (requestAbort.signal.aborted) break
          writer.write(chunk)
        }
      } catch (error: any) {
        if (!requestAbort.signal.aborted) {
          writer.write({ type: 'error', message: error.message })
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
