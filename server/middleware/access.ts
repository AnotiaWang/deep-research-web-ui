import { assertAccessAuthorized } from '~~/server/utils/access'

/**
 * Guards every API route except the status probe when NUXT_ACCESS_PASSWORD is set.
 *
 * The path is taken from `event.path`, which h3 has already percent-decoded and stripped of the
 * app base URL. `getRequestURL(event).pathname` cannot be used here: it re-parses the raw request
 * URL, so `/%61pi/research` would fail the prefix test and still reach the decoded handler.
 */
export default defineEventHandler((event) => {
  const pathname = event.path.split('?')[0] ?? ''
  if (!pathname.startsWith('/api/') || pathname === '/api/access') return
  assertAccessAuthorized(event)
})
