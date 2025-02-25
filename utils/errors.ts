import { APICallError } from 'ai'

/**
 * Parse an error thrown by the AI SDK, and re-throw it with a human-readable message
 */
export function throwAiError(operation: string, error: unknown) {
  if (APICallError.isInstance(error)) {
    let message = error.message
    if (error.statusCode) message += ` (${error.statusCode})`
    if (error.cause) message += `\nCause: ${error.cause}`
    if (error.responseBody) message += `\nResponse: ${error.responseBody}`
    if (error.url) message += `\nURL: ${error.url}`

    console.error(`[${operation}]`, error, {
      statusCode: error.statusCode,
      response: error.responseBody,
      cause: error.cause,
      stack: error.stack,
      isRetryable: error.isRetryable,
      url: error.url,
    })
    throw new Error(message)
  } else {
    console.error(`[${operation}]`, error)
  }
  throw error
}
