import { assertAccessAuthorized } from '~~/server/utils/access'

/**
 * Guards every API route.
 *
 * Two path interpretations are needed here, and they are not interchangeable:
 *
 * - `getRequestURL(event).pathname` is the raw, still-encoded request path. It is the only value
 *   that still shows `/api%2fresearch` or `/%61pi/research` as such, because h3 has already
 *   decoded `event.path`. Requiring the plain `/api/` prefix therefore fails closed on encoded
 *   paths instead of letting them reach a decoded handler unguarded.
 * - `event.path` is canonical, which is what the `/api/access` exemption has to match.
 *
 * The exemption is keyed on the canonical path, because that is what the router matches: an
 * encoded `/%61pi/access` goes to the same probe handler and is anonymous either way.
 */
export default defineEventHandler((event) => {
  const rawPathname = getRequestURL(event).pathname
  const canonicalPath = event.path.split('?')[0] ?? ''

  if (canonicalPath === '/api/access') return
  const isApiPath = rawPathname.startsWith('/api/') || canonicalPath.startsWith('/api/')
  if (!isApiPath) return

  assertAccessAuthorized(event)
})
