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
