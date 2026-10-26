import { APICallError, RetryError } from 'ai'
import { redactSecrets } from '~~/shared/utils/redact'

/**
 * Full upstream detail is logged server-side only. It must never reach `error.message`: the
 * stream handlers forward that message to the browser, and providers echo the rejected key
 * (`Incorrect API key provided: sk-...`), the gateway URL and its response body there.
 */
function logApiCallError(operation: string, error: APICallError) {
  console.error(`[${operation}]`, error, {
    statusCode: error.statusCode,
    response: error.responseBody ? redactSecrets(error.responseBody) : undefined,
    cause: error.cause ? redactSecrets(String(error.cause)) : undefined,
    stack: error.stack,
    isRetryable: error.isRetryable,
    url: error.url,
  })
}

function handleApiCallError(operation: string, error: APICallError) {
  logApiCallError(operation, error)
  // Only the status survives: upstream prose is untrusted and may carry credentials.
  const message = error.statusCode
    ? `The AI provider rejected the request (HTTP ${error.statusCode}).`
    : 'The AI provider request failed.'
  throw new Error(message, { cause: error })
}

function handleRetryError(operation: string, error: RetryError) {
  if (APICallError.isInstance(error.lastError)) {
    handleApiCallError(operation, error.lastError)
  }
  console.error(`[${operation}]`, error, {
    cause: error.cause ? redactSecrets(String(error.cause)) : undefined,
    stack: error.stack,
    lastError: redactSecrets(String(error.lastError)),
    reason: error.reason,
  })
  throw new Error('The AI provider request failed after retries.', { cause: error })
}

/**
 * Parse an error thrown by the AI SDK, log it, and re-throw a message that is safe to show a client.
 */
export function throwAiError(operation: string, error: unknown) {
  if (APICallError.isInstance(error)) {
    handleApiCallError(operation, error)
  } else if (RetryError.isInstance(error)) {
    handleRetryError(operation, error)
  } else {
    console.error(`[${operation}]`, error)
  }
  throw error
}
