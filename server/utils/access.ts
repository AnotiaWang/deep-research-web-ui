import { createHash, timingSafeEqual } from 'node:crypto'
import type { H3Event } from 'h3'
import { ACCESS_PASSWORD_HEADER, type AccessStatus } from '~~/shared/utils/access'

function digest(value: string) {
  return createHash('sha256').update(value).digest()
}

/** Constant-time comparison of a URI-encoded header value against the configured password. */
export function isAccessPasswordValid(provided: string | undefined, expected: string) {
  if (!provided) return false
  let decoded: string
  try {
    decoded = decodeURIComponent(provided)
  } catch {
    return false
  }
  return timingSafeEqual(digest(decoded), digest(expected))
}

export function getAccessStatus(event: H3Event): AccessStatus {
  const expected = useRuntimeConfig(event).accessPassword
  if (!expected) return { required: false, authorized: true }
  return {
    required: true,
    authorized: isAccessPasswordValid(getHeader(event, ACCESS_PASSWORD_HEADER), expected),
  }
}

/**
 * Throws unless the caller presented the access password (or none is configured).
 *
 * Every route that spends server-side credentials calls this itself, so a mismatch between the
 * middleware's idea of the path and the router's cannot leave a handler unguarded.
 */
export function assertAccessAuthorized(event: H3Event) {
  const status = getAccessStatus(event)
  if (status.required && !status.authorized) {
    throw createError({ statusCode: 401, statusMessage: 'Access password required' })
  }
}
