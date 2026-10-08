import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { CallToolResultSchema, McpError } from '@modelcontextprotocol/sdk/types.js'
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
  const callSignals = new AsyncLocalStorage<AbortSignal>()
  // Identify aggregate project usage; never add user or installation identifiers.
  const userAgent = `deep-research-web-ui/${project.version}`

  type Connection = {
    client: Client
    transport: StreamableHTTPClientTransport
    abort: AbortController
    ready: Promise<void>
  }
  let connection: Connection | undefined
  let closed = false
  const sourceQueries = new Map<string, string[]>()

  async function closeConnection(current: Connection) {
    current.abort.abort(new Error('Parallel Search MCP connection closed.'))
    try {
      await current.transport.terminateSession()
    } catch {
      // Cleanup must not hide the research result or original error.
    }
    await current.client.close().catch(() => {})
  }

  function connect(): Connection {
    if (connection) return connection
    const abort = new AbortController()
    const doFetch = config.fetch ?? fetch
    const boundedFetch: typeof fetch = async (input, init) => {
      const requestSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
      const callSignal = callSignals.getStore()
      const response = await doFetch(input, {
        ...init,
        redirect: 'error',
        signal:
          init?.method === 'DELETE'
            ? AbortSignal.timeout(1_000)
            : AbortSignal.any([
                abort.signal,
                ...(requestSignal ? [requestSignal] : []),
                ...(callSignal ? [callSignal] : []),
              ]),
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
    // Unmatched protocol errors must fail active calls instead of waiting for timeout.
    client.onerror = (error) => {
      if (!callSignals.getStore()?.aborted) abort.abort(error)
    }
    const current: Connection = { client, transport, abort, ready: Promise.resolve() }
    connection = current
    current.ready = abortable(
      client.connect(transport),
      AbortSignal.any([abort.signal, AbortSignal.timeout(timeoutMs)]),
    ).catch(async (error) => {
      if (connection === current) connection = undefined
      await closeConnection(current)
      throw error
    })
    return current
  }

  async function call(name: 'web_search' | 'web_fetch', args: object, callerSignal?: AbortSignal) {
    throwIfAborted(callerSignal)
    if (closed) throw new Error('Parallel Search MCP research operation is closed.')
    const current = connect()
    const timeout = AbortSignal.timeout(timeoutMs)
    const signal = AbortSignal.any([
      timeout,
      current.abort.signal,
      ...(callerSignal ? [callerSignal] : []),
    ])
    let result: unknown
    try {
      await abortable(current.ready, signal)
      result = await callSignals.run(signal, () =>
        current.client.callTool(
          { name, arguments: { ...args, session_id: sessionId } },
          undefined,
          {
            signal,
            timeout: timeoutMs,
          },
        ),
      )
    } catch (error) {
      if (signal.aborted) error = signal.reason
      // Only transport/session failures poison the shared connection. A canceled or
      // timed-out call, or a JSON-RPC error for this request, must not interrupt
      // other calls; service/session failures are retried by the next tool call.
      const callOnly = callerSignal?.aborted || timeout.aborted || error instanceof McpError
      if (!callOnly && connection === current) {
        connection = undefined
        await closeConnection(current)
      }
      if (error instanceof StreamableHTTPError && error.code) {
        throw new Error(`Parallel Search MCP HTTP ${error.code}: ${error.message}`, {
          cause: error,
        })
      }
      throw error
    }
    // Tool errors and malformed payloads only fail this call.
    return payload(result)
  }

  const search: WebSearchFunction = async (query, options = {}) => {
    const constraints = searchConstraintsSchema.parse(options)
    const plan = resolveSearchPlan({
      ...constraints,
      query,
      researchGoal: options.researchGoal ?? '',
    })
    options.onNotice?.(buildSearchFilters('parallel', { ...options, ...plan }).limitations)
    const data = await call(
      'web_search',
      { objective: options.researchGoal?.trim() || query, search_queries: [query] },
      options.signal,
    )
    for (const result of data.results) {
      const queries = sourceQueries.get(result.url) ?? []
      if (!queries.includes(query)) queries.push(query)
      sourceQueries.set(result.url, queries)
    }
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
        ...(sourceQueries.has(url) ? { search_queries: sourceQueries.get(url) } : {}),
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
  search.close = async () => {
    closed = true
    const current = connection
    connection = undefined
    if (current) await closeConnection(current)
  }
  return search
}
