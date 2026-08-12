export function getStreamErrorMessage(chunk: { error?: unknown; message?: unknown }) {
  const error = chunk.error ?? chunk.message ?? 'Unknown stream error'
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message
  }
  return error instanceof Error ? error.message : String(error)
}
