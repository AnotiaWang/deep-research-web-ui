// Publish a finished report as a standalone public web page on deed.page.
// Uses the keyless MCP endpoint over plain JSON-RPC, straight from the browser.

export const DEEDPAGE_MCP_URL = 'https://deed.page/mcp'

export interface PublishedReport {
  url: string
  slug: string
  /** Management token for updating or deleting the page. Only shown to the user. */
  token?: string
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char]!)
}

/**
 * Wraps already-sanitized report HTML (from `renderSafeMarkdown`) in a small
 * self-contained document. The title is escaped; nothing is loaded from other hosts.
 */
export function buildReportDocument(title: string, reportHtml: string, lang = 'en') {
  const safeTitle = escapeHtml(title.trim() || 'Deep Research Report')
  return `<!doctype html>
<html lang="${escapeHtml(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
<style>
body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.6;max-width:46rem;margin:2rem auto;padding:0 1rem;color:#1f2937}
a{color:#2563eb}table{border-collapse:collapse}td,th{border:1px solid #d1d5db;padding:.25rem .5rem}
pre{overflow:auto;background:#f3f4f6;padding:.75rem}.citation-ref{vertical-align:super;font-size:.75rem}
.citation-ref a{text-decoration:none}footer{margin-top:3rem;color:#6b7280;font-size:.875rem}
</style>
</head>
<body>
<main>
<h1>${safeTitle}</h1>
${reportHtml}
</main>
<footer>Generated with Deep Research Web UI.</footer>
</body>
</html>
`
}

function readJsonRpc(text: string, contentType: string | null) {
  if (contentType?.includes('text/event-stream')) {
    const data = text
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .filter(Boolean)
      .pop()
    if (!data) throw new Error('Empty response from deed.page')
    return JSON.parse(data)
  }
  return JSON.parse(text)
}

/** Publishes `html` as index.html. Pass `ttlSeconds` to let the page expire on its own. */
export async function publishReportPage(
  html: string,
  options: { ttlSeconds?: number; signal?: AbortSignal; fetchFn?: typeof fetch } = {},
): Promise<PublishedReport> {
  const fetchFn = options.fetchFn ?? fetch
  const args: Record<string, unknown> = { files: { 'index.html': html } }
  if (options.ttlSeconds && options.ttlSeconds > 0) args.ttl_seconds = options.ttlSeconds

  const response = await fetchFn(DEEDPAGE_MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'publish_site', arguments: args },
    }),
    signal: options.signal,
  })
  if (!response.ok) throw new Error(`deed.page returned HTTP ${response.status}`)

  const message = readJsonRpc(await response.text(), response.headers.get('content-type'))
  if (message.error) throw new Error(message.error.message || 'deed.page request failed')
  const text = (message.result?.content ?? [])
    .filter((block: { type?: string }) => block.type === 'text')
    .map((block: { text: string }) => block.text)
    .join('\n')
  if (message.result?.isError) throw new Error(text || 'deed.page could not publish the page')

  const site = (message.result?.structuredContent ?? JSON.parse(text)) as Partial<PublishedReport>
  let url: URL
  try {
    url = new URL(String(site.url))
  } catch {
    throw new Error('deed.page returned an invalid page URL')
  }
  if (url.protocol !== 'https:' || !site.slug) {
    throw new Error('deed.page returned an invalid page URL')
  }
  return { url: url.href, slug: site.slug, token: site.token }
}
