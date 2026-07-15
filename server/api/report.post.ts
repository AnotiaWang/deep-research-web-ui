import { writeFinalReport } from '~~/lib/core/deep-research'
import type { ConfigAi } from '~~/shared/types/config'
import { getStreamErrorMessage } from '~~/shared/utils/stream-error'

export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig()
  const body = await readBody(event)

  const { prompt, learnings, language } = body

  // Validate required parameters
  if (!prompt || !learnings || !language) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing required parameters',
    })
  }

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

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()

      try {
        const reportGenerator = writeFinalReport({
          prompt,
          learnings,
          language,
          aiConfig: serverConfig,
        })

        for await (const chunk of reportGenerator.fullStream) {
          const serializableChunk =
            chunk.type === 'error' ? { type: 'error', error: getStreamErrorMessage(chunk) } : chunk
          const data = `data: ${JSON.stringify(serializableChunk)}\n\n`
          controller.enqueue(encoder.encode(data))
        }

        controller.close()
      } catch (error: any) {
        const errorData = `data: ${JSON.stringify({
          type: 'error',
          error: getStreamErrorMessage({ error }),
        })}\n\n`
        controller.enqueue(encoder.encode(errorData))
        controller.close()
      }
    },
  })

  return sendStream(event, stream)
})
