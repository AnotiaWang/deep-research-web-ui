import { randomUUID } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import project from '../../public/version.json' with { type: 'json' }
import { buildSearchFilters, type WebSearchFunction } from '~~/lib/core/web-search'
import { searchConstraintsSchema, resolveSearchPlan } from '~~/shared/utils/search-plan'
import { abortable, throwIfAborted } from '~~/shared/utils/abort'
import type { WebSearchResult } from '~~/shared/types/types'

const endpoint = 'https://search.parallel.ai/mcp'
const timeoutMs = 60_000
const maxResponseBytes = 2 * 1024 * 1024
const resultSchema = z.object({
  url: z.string().url(),
  title: z.string().nullish(),
  publish_date: z.string().nullish(),
  excerpts: z.array(z.string()),
  full_content: z.string().nullish(),
})
const payloadSchema = z.object({
  results: z.array(resultSchema),
  warnings: z
    .array(z.union([z.string(), z.object({ message: z.string() }).passthrough()]))
    .nullish(),
  errors: z.array(z.object({ url: z.string() }).passthrough()).nullish(),
})

function payload(value: unknown) {
  const result = CallToolResultSchema.parse(value)
  if (result.isError) {
    throw new Error('Parallel Search MCP returned a tool error.')
  }
  const text = result.content.find((item) => item.type === 'text')
  const data = payloadSchema.parse(
    result.structuredContent ?? (text?.type === 'text' ? JSON.parse(text.text) : undefined),
  )
  if (data.warnings?.length)
    console.warn(
      '[Parallel Search MCP]',
      ...data.warnings.map((warning) => (typeof warning === 'string' ? warning : warning.message)),
    )
  return data
}

/** Each factory belongs to one research operation, including its recursive branches. */
export function createParallelWebSearch(config: { fetch?: typeof fetch } = {}): WebSearchFunction {
  const sessionId = randomUUID()
  // Identify aggregate project usage; never add user or installation identifiers.
  const userAgent = `deep-research-web-ui/${project.version}`

  async function call(name: 'web_search' | 'web_fetch', args: object, callerSignal?: AbortSignal) {
    throwIfAborted(callerSignal)
    const protocolAbort = new AbortController()
    let signal = AbortSignal.any([
      AbortSignal.timeout(timeoutMs),
      protocolAbort.signal,
      ...(callerSignal ? [callerSignal] : []),
    ])
    const doFetch = config.fetch ?? fetch
    const boundedFetch: typeof fetch = async (input, init) => {
      const requestSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
      const response = await doFetch(input, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.any([signal, ...(requestSignal ? [requestSignal] : [])]),
      })
      if (!response.body) return response
      let bytes = 0
      const body = response.body.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            bytes += chunk.byteLength
            if (bytes > maxResponseBytes) {
              controller.error(new Error('Parallel Search MCP response exceeded 2 MiB.'))
            } else controller.enqueue(chunk)
          },
        }),
      )
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      })
    }
    const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
      fetch: boundedFetch,
      requestInit: { headers: { 'User-Agent': userAgent }, redirect: 'error' },
    })
    const client = new Client({ name: 'deep-research-web-ui', version: project.version })
    // Protocol errors without a matching response ID must fail instead of waiting for timeout.
    client.onerror = (error) => protocolAbort.abort(error)
    try {
      await abortable(client.connect(transport), signal)
      let cursor: string | undefined
      const cursors = new Set<string>()
      let found = false
      do {
        const page = await client.listTools(cursor ? { cursor } : undefined, { signal })
        found ||= page.tools.some((tool) => tool.name === name)
        cursor = page.nextCursor
        if (cursor && cursors.has(cursor)) throw new Error('Repeated MCP discovery cursor.')
        if (cursor) cursors.add(cursor)
      } while (cursor)
      if (!found) throw new Error(`Parallel Search MCP does not expose ${name}.`)
      return payload(
        await client.callTool({ name, arguments: { ...args, session_id: sessionId } }, undefined, {
          signal,
          timeout: timeoutMs,
        }),
      )
    } catch (error) {
      if (signal.aborted) error = signal.reason
      if (error instanceof StreamableHTTPError && error.code) {
        throw new Error(`Parallel Search MCP HTTP ${error.code}: ${error.message}`, {
          cause: error,
        })
      }
      throw error
    } finally {
      // Cleanup has its own short deadline and must not hide the original outcome.
      signal = AbortSignal.timeout(1_000)
      try {
        await transport.terminateSession()
      } catch {
        // The next call can reconnect while keeping the research session identifier.
      }
      await client.close().catch(() => {})
    }
  }

  const search: WebSearchFunction = async (query, options = {}) => {
    const constraints = searchConstraintsSchema.parse(options)
    const plan = resolveSearchPlan({ ...constraints, query, researchGoal: '' })
    options.onNotice?.(buildSearchFilters('parallel', { ...options, ...plan }).limitations)
    const data = await call(
      'web_search',
      { objective: query, search_queries: [query] },
      options.signal,
    )
    return data.results
      .flatMap<WebSearchResult>((result) => {
        const content = result.excerpts.join('\n').trim()
        if (!content) return []
        return [
          {
            url: result.url,
            title: result.title ?? undefined,
            publishedAt: result.publish_date ?? undefined,
            content,
            sourceType: 'search-result',
          },
        ]
      })
      .slice(0, options.maxResults ?? 5)
  }
  search.provider = 'parallel'
  search.readSource = async (url, { signal }) => {
    const data = await call(
      'web_fetch',
      {
        urls: [url],
        objective: 'Read this source page to verify research evidence.',
        full_content: true,
      },
      signal,
    )
    const result = data.results[0]
    if (!result?.full_content?.trim()) {
      if (data.errors?.length) throw new Error('Parallel Search MCP could not read the source URL.')
      return undefined
    }
    return {
      url,
      finalUrl: result.url,
      title: result.title ?? undefined,
      publishedAt: result.publish_date ?? undefined,
      content: result.full_content,
      sourceType: 'page',
    }
  }
  return search
}
