import { createHash, timingSafeEqual } from 'node:crypto'
import type { H3Event } from 'h3'
import {
  ACCESS_PASSWORD_HEADER,
  type AccessRejection,
  type AccessStatus,
} from '~~/shared/utils/access'

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
 * A plain HTML form can set neither a custom header nor `Content-Type: application/json`, so the
 * password header is already out of reach for one. This check covers the deployment that runs
 * without a password: without it any page could spend the server's keys through a visitor's
 * browser. Only an affirmative cross-site signal rejects; a missing `Origin` (curl,
 * server-to-server) still works, and so does a same-origin POST, which browsers do label.
 */
function isCrossSiteRequest(event: H3Event) {
  const fetchSite = getHeader(event, 'sec-fetch-site')
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') return true

  const origin = getHeader(event, 'origin')
  if (!origin) return false
  let originHost: string
  try {
    originHost = new URL(origin).host
  } catch {
    // An unparseable Origin is not a same-origin claim.
    return true
  }
  // Behind a reverse proxy `Host` may be rewritten while the browser's Origin stays public, so
  // accept any host the proxy says it received the request for.
  const candidates = [getHeader(event, 'host'), getHeader(event, 'x-forwarded-host')]
    .filter((value): value is string => !!value)
    .flatMap((value) => value.split(','))
    .map((value) => value.trim().toLowerCase())
  return !candidates.includes(originHost.toLowerCase())
}

/**
 * Explains why a request may not spend server-side credentials, or `undefined` when it may.
 *
 * The server-mode flag is enforced here rather than only in the UI: `NUXT_PUBLIC_SERVER_MODE`
 * defaults to false, and operators who leave it off do not configure a password, so an ignored
 * flag would leave an unauthenticated proxy for the server's keys.
 */
export function getAccessRejection(event: H3Event): AccessRejection | undefined {
  if (!useRuntimeConfig(event).public.serverMode) return 'server-mode-disabled'
  const status = getAccessStatus(event)
  if (status.required && !status.authorized) return 'password-required'
  if (isCrossSiteRequest(event)) return 'cross-site-request'
  return undefined
}

const REJECTION_MESSAGES: Record<AccessRejection, string> = {
  'server-mode-disabled': 'Server mode is disabled on this deployment',
  'password-required': 'Access password required',
  'cross-site-request': 'Cross-site requests are not allowed',
}

/** Throws unless the caller may spend server-side credentials. */
export function assertAccessAuthorized(event: H3Event) {
  const rejection = getAccessRejection(event)
  if (!rejection) return
  throw createError({
    statusCode: rejection === 'cross-site-request' ? 403 : 401,
    statusMessage: REJECTION_MESSAGES[rejection],
  })
}
