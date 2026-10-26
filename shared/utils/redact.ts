/**
 * Scrubs credentials out of text that is about to leave the server.
 *
 * Upstream providers echo the credential they rejected (`Incorrect API key provided: sk-...`),
 * and Google PSE carries its key in the query string, so error text cannot be forwarded verbatim.
 * This is a safety net for upstream prose, not a substitute for never putting secrets in a message.
 */
const SECRET_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  // Authorization header echoes: "Bearer sk-...", "Basic dXNlcjo="
  [/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [redacted]'],
  // Provider key prefixes: sk-, sk-proj-, pk-, rk-
  [/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{8,}/gi, '[redacted]'],
  // Credentials carried in query strings (Google PSE, You.com, Firecrawl)
  [/([?&](?:key|api_key|apikey|access_token|token|auth)=)[^&\s"'`]+/gi, '$1[redacted]'],
  // Header dumps: `x-api-key: abc`, `"x-goog-api-key": "abc"`
  [/("?(?:x-api-key|x-goog-api-key|x-auth-token)"?\s*[:=]\s*"?)[^\s"',}]+/gi, '$1[redacted]'],
]

/** Longest error text forwarded to a browser; upstream bodies can be arbitrarily large. */
export const MAX_CLIENT_ERROR_LENGTH = 500

export function redactSecrets(text: string): string {
  let redacted = text
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, replacement)
  }
  return redacted
}

/** Redacts and truncates text before it is streamed to a client. */
export function toClientErrorMessage(text: string, maxLength = MAX_CLIENT_ERROR_LENGTH): string {
  const redacted = redactSecrets(text).trim()
  return redacted.length <= maxLength ? redacted : `${redacted.slice(0, maxLength)}…`
}
