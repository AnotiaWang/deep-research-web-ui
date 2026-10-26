import { toClientErrorMessage } from '~~/shared/utils/redact'

/**
 * Upstream API errors carry the gateway URL, its response body and often the rejected credential.
 * The AI SDK also emits them as stream parts, bypassing `throwAiError`, so they have to be
 * recognised here rather than only where they are thrown.
 */
function isUpstreamApiError(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    ('responseBody' in error || 'statusCode' in error) &&
    'url' in error
  )
}

function statusOf(error: unknown) {
  const statusCode = (error as { statusCode?: unknown }).statusCode
  return typeof statusCode === 'number' ? statusCode : undefined
}

/**
 * Reads the message out of a stream error frame.
 *
 * The result is shown to a browser, so upstream prose is replaced by a status code and any other
 * text is scrubbed and truncated. Messages this project writes itself — truncated model output,
 * invalid structured output — pass through intact.
 */
export function getStreamErrorMessage(chunk: { error?: unknown; message?: unknown }) {
  const error = chunk.error ?? chunk.message ?? 'Unknown stream error'

  const candidate =
    typeof error === 'object' && error !== null && 'message' in error && !isUpstreamApiError(error)
      ? (error as { message: unknown }).message
      : error
  const resolved =
    typeof candidate === 'string'
      ? candidate
      : candidate instanceof Error
        ? candidate.message
        : String(candidate)

  if (isUpstreamApiError(error) || isUpstreamApiError(candidate)) {
    const status = statusOf(error) ?? statusOf(candidate)
    return status
      ? `The AI provider rejected the request (HTTP ${status}).`
      : 'The AI provider request failed.'
  }
  return toClientErrorMessage(resolved)
}
