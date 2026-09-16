/**
 * Server-only outbound proxy support (HTTP/HTTPS/SOCKS5).
 *
 * Two transports, chosen by proxy scheme (all verified against Helodata):
 *
 * - `http://` / `https://` proxy: axios transport. axios preserves the
 *   canonical `Proxy-Authorization` header case that some gateways require,
 *   and handles CONNECT tunneling, auth and redirects.
 * - `socks5://` / `socks5h://` / `socks://` proxy: undici ProxyAgent transport
 *   (`socks5h` is normalized to `socks5`; undici always sends the target
 *   hostname for remote DNS resolution, i.e. `socks5h` behavior).
 *
 * Coverage:
 * - fetch paths (AI SDK providers, Google PSE, you.com): explicit `proxyFetch`
 *   injection, all schemes supported.
 * - axios paths (Tavily / Firecrawl / CRW SDKs): via `HTTP_PROXY` /
 *   `HTTPS_PROXY` / `NO_PROXY` env applied by the Nitro plugin. axios cannot
 *   speak SOCKS, so SOCKS proxies only cover the fetch paths there.
 *
 * Never logs raw proxy URLs (credentials). Use {@link redactProxyUrl}.
 */
import axios, { AxiosHeaders, isAxiosError } from 'axios'
import { Readable } from 'node:stream'
import { ProxyAgent, fetch as undiciFetch } from 'undici'

export type ProxyProtocol = 'http:' | 'https:' | 'socks5:' | 'socks5h:' | 'socks:'

export interface ParsedProxy {
  protocol: ProxyProtocol
  host: string
  port: number
  username?: string
  password?: string
  /** Redacted `protocol//user:***@host:port`, safe for logs. */
  redacted: string
}

export interface ResolvedProxy {
  proxy: ParsedProxy
  /** Effective NO_PROXY list (already defaulted, raw string form). */
  noProxy: string
}

const DEFAULT_NO_PROXY = 'localhost,127.0.0.1,::1'
const SUPPORTED_PROTOCOLS: ProxyProtocol[] = ['http:', 'https:', 'socks5:', 'socks5h:', 'socks:']

function defaultPort(protocol: ProxyProtocol): number {
  return protocol === 'http:' || protocol === 'https:' ? 8080 : 1080
}

/** Parse and validate a proxy URL. Throws on unsupported/empty input. */
export function parseProxyUrl(raw: string): ParsedProxy {
  const value = raw.trim()
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(
      `Invalid proxy URL (expected like http://user:pass@host:port): ${(value || '(empty)').slice(0, 60)}`,
    )
  }
  const protocol = url.protocol.toLowerCase() as ProxyProtocol
  if (!SUPPORTED_PROTOCOLS.includes(protocol)) {
    throw new Error(
      `Unsupported proxy protocol "${url.protocol}" (supported: http, https, socks5, socks5h, socks)`,
    )
  }
  if (!url.hostname) throw new Error('Invalid proxy URL: missing hostname')
  let username: string | undefined
  let password: string | undefined
  try {
    username = url.username ? decodeURIComponent(url.username) : undefined
    password = url.password ? decodeURIComponent(url.password) : undefined
  } catch {
    throw new Error('Invalid proxy URL: username/password must be URL-encoded (e.g. "%" as "%25")')
  }
  const redacted = `${protocol}//${username ?? '(no-auth)'}:***@${url.hostname}:${url.port || defaultPort(protocol)}`
  return {
    protocol,
    host: url.hostname,
    port: url.port ? Number(url.port) : defaultPort(protocol),
    username,
    password,
    redacted,
  }
}

/** Redact a proxy URL for logs. Never throws, never leaks credentials. */
export function redactProxyUrl(raw: string | undefined | null): string {
  if (!raw || !raw.trim()) return '(no proxy)'
  try {
    return parseProxyUrl(raw).redacted
  } catch {
    return '(invalid proxy url)'
  }
}

/** NO_PROXY matching: `*`, exact host, `.suffix` / suffix, case-insensitive. */
export function shouldBypassProxy(hostname: string, noProxy: string | undefined | null): boolean {
  if (!noProxy) return false
  const host = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
  if (!host) return false
  for (const rawEntry of noProxy.split(',')) {
    let entry = rawEntry.trim().toLowerCase()
    if (!entry) continue
    // Strip `:port` (but keep IPv6 literals).
    if (
      entry.includes(':') &&
      !entry.startsWith('[') &&
      entry.indexOf(':') === entry.lastIndexOf(':')
    ) {
      entry = entry.slice(0, entry.indexOf(':'))
    }
    entry = entry.replace(/^\[|\]$/g, '')
    if (!entry) continue
    if (entry === '*') return true
    const suffix = entry.startsWith('.') ? entry.slice(1) : entry
    if (host === suffix || host.endsWith(`.${suffix}`)) return true
  }
  return false
}

function pickEnv(names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim()
    if (value) return value
  }
  return undefined
}

export interface ProxyEnvInput {
  proxyUrl?: string | null
  noProxy?: string | null
}

/**
 * Resolve effective proxy config. Precedence: explicit input (NUXT_*) first,
 * then standard `*_PROXY` env vars. Returns null when no proxy is configured.
 *
 * Fail-fast rule: an explicit (NUXT_*) value must parse, otherwise this throws
 * and Nitro refuses to boot. Ambient `*_PROXY` env garbage is only warned
 * about and ignored, so unrelated shell env cannot brick the server.
 */
export function resolveProxyConfig(input: ProxyEnvInput = {}): ResolvedProxy | null {
  const explicit = input.proxyUrl?.trim()
  if (explicit) {
    const proxy = parseProxyUrl(explicit)
    const noProxy = input.noProxy?.trim() || pickEnv(['NO_PROXY', 'no_proxy']) || DEFAULT_NO_PROXY
    return { proxy, noProxy }
  }
  const ambient = pickEnv([
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'ALL_PROXY',
    'http_proxy',
    'https_proxy',
    'all_proxy',
  ])
  if (!ambient) return null
  try {
    const proxy = parseProxyUrl(ambient)
    const noProxy = pickEnv(['NO_PROXY', 'no_proxy']) || DEFAULT_NO_PROXY
    return { proxy, noProxy }
  } catch (error) {
    console.warn(
      `[proxy] Ignoring invalid *_PROXY env value: ${error instanceof Error ? error.message : error}`,
    )
    return null
  }
}

/** True when the proxy scheme works for axios-based SDKs (Tavily/Firecrawl). */
export function isAxiosCompatibleProxy(proxy: ParsedProxy): boolean {
  return proxy.protocol === 'http:' || proxy.protocol === 'https:'
}

function abortError(): Error {
  if (typeof DOMException !== 'undefined') {
    return new DOMException('The operation was aborted.', 'AbortError')
  }
  const error = new Error('The operation was aborted.')
  error.name = 'AbortError'
  return error
}

const SENSITIVE_HEADER_NAMES = ['authorization', 'proxy-authorization', 'x-api-key', 'api-key']

/**
 * Strip secrets from an axios error before it enters the `cause` chain.
 * Server logs print error causes deeply (`shared/utils/errors.ts`), and the
 * axios error carries the proxy password (`config.proxy.auth`) plus the AI
 * provider key (`config.headers`). The error instance is fresh from this
 * request, so in-place redaction is safe.
 */
function sanitizeAxiosError(error: unknown): void {
  if (!isAxiosError(error) || !error.config) return
  const config = error.config as unknown as Record<string, unknown>
  const proxy = config.proxy as Record<string, unknown> | undefined
  if (proxy && typeof proxy === 'object' && proxy.auth !== undefined) {
    proxy.auth = '(redacted)'
  }
  const headers = config.headers as unknown as
    | {
        has?: (name: string) => boolean
        set?: (name: string, value: string) => void
        [key: string]: unknown
      }
    | undefined
  if (!headers || typeof headers !== 'object') return
  if (typeof headers.has === 'function' && typeof headers.set === 'function') {
    for (const name of SENSITIVE_HEADER_NAMES) {
      if (headers.has(name)) headers.set(name, '(redacted)')
    }
    return
  }
  for (const key of Object.keys(headers)) {
    if (SENSITIVE_HEADER_NAMES.includes(key.toLowerCase())) {
      headers[key] = '(redacted)'
    }
  }
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
}

function requestHeaders(
  input: Parameters<typeof fetch>[0],
  init?: RequestInit,
): Record<string, string> {
  const out: Record<string, string> = {}
  const merge = (headers: HeadersInit | undefined) => {
    if (!headers) return
    if (headers instanceof Headers) {
      headers.forEach((value, key) => {
        out[key] = value
      })
    } else if (Array.isArray(headers)) {
      for (const [key, value] of headers) out[key] = value
    } else {
      Object.assign(out, headers)
    }
  }
  merge(typeof input === 'object' && 'headers' in input ? (input as Request).headers : undefined)
  merge(init?.headers)
  return out
}

async function normalizeAxiosBody(body: BodyInit | null | undefined): Promise<unknown> {
  if (body == null) return undefined
  if (
    typeof body === 'string' ||
    body instanceof URLSearchParams ||
    body instanceof Blob ||
    (typeof FormData !== 'undefined' && body instanceof FormData) ||
    Buffer.isBuffer(body)
  ) {
    return body
  }
  if (body instanceof ArrayBuffer) return Buffer.from(body)
  if (ArrayBuffer.isView(body)) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength)
  }
  const stream = body as unknown as {
    getReader?: unknown
    pipe?: unknown
  }
  if (typeof stream.getReader === 'function') {
    return Buffer.from(await new Response(body).arrayBuffer())
  }
  if (typeof stream.pipe === 'function') {
    const chunks: Buffer[] = []
    for await (const chunk of body as unknown as AsyncIterable<Buffer | string>) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk))
    }
    return Buffer.concat(chunks)
  }
  return body
}

/** axios-backed fetch for `http(s)` proxies. Preserves header case. */
async function axiosProxyFetch(
  proxy: ParsedProxy,
  input: Parameters<typeof fetch>[0],
  init?: RequestInit,
): Promise<Response> {
  const url = requestUrl(input)
  const baseHeaders = requestHeaders(input, init)
  // axios reroutes through its own merging; keep the method explicit.
  const method =
    init?.method ??
    (typeof input === 'object' && 'method' in input ? (input as Request).method : 'GET')
  try {
    const response = await axios.request({
      url,
      method,
      headers: baseHeaders,
      data: await normalizeAxiosBody(
        init?.body ??
          (typeof input === 'object' && 'body' in input
            ? ((input as Request).body as BodyInit | null)
            : null),
      ),
      signal: init?.signal as never,
      responseType: 'stream',
      // fetch resolves on HTTP error statuses; only network failures reject.
      validateStatus: () => true,
      maxRedirects: init?.redirect === 'error' || init?.redirect === 'manual' ? 0 : 5,
      proxy: {
        protocol: proxy.protocol.replace(/:$/, ''),
        host: proxy.host,
        port: proxy.port,
        ...(proxy.username
          ? { auth: { username: proxy.username, password: proxy.password ?? '' } }
          : {}),
      },
    })
    if (init?.redirect === 'error' && [301, 302, 303, 307, 308].includes(response.status)) {
      response.data.destroy()
      throw new Error('Redirects are disabled for this request.')
    }
    const headers = new Headers()
    const rawHeaders = AxiosHeaders.from(response.headers as unknown as AxiosHeaders).toJSON()
    for (const [key, value] of Object.entries(rawHeaders)) {
      if (Array.isArray(value)) {
        for (const item of value) headers.append(key, item)
      } else {
        headers.append(key, value)
      }
    }
    return new Response(Readable.toWeb(response.data as Readable) as ReadableStream, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  } catch (error) {
    if (
      (init?.signal as AbortSignal | undefined)?.aborted ||
      (isAxiosError(error) && (error.code === 'ERR_CANCELED' || error.name === 'CanceledError'))
    ) {
      throw abortError()
    }
    sanitizeAxiosError(error)
    throw new TypeError(
      `Proxy request failed (${proxy.redacted}): ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
}

const socksDispatchers = new Map<string, ProxyAgent>()

function socksDispatcher(proxy: ParsedProxy): ProxyAgent {
  // undici accepts `socks5:`/`socks:`; `socks5h:` normalizes to `socks5:`
  // (undici always resolves target hostnames remotely, i.e. socks5h behavior).
  const key = `${proxy.host}:${proxy.port}:${proxy.username ?? ''}`
  const hit = socksDispatchers.get(key)
  if (hit) return hit
  const auth = proxy.username
    ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password ?? '')}@`
    : ''
  const dispatcher = new ProxyAgent(`socks5://${auth}${proxy.host}:${proxy.port}`)
  socksDispatchers.set(key, dispatcher)
  return dispatcher
}

/** undici-backed fetch for `socks*` proxies (binary auth, no header issue). */
async function socksProxyFetch(
  proxy: ParsedProxy,
  input: Parameters<typeof fetch>[0],
  init?: RequestInit,
): Promise<Response> {
  try {
    return (await undiciFetch(
      input as never,
      { ...(init as Record<string, unknown>), dispatcher: socksDispatcher(proxy) } as never,
    )) as unknown as Response
  } catch (error) {
    if (
      (init?.signal as AbortSignal | undefined)?.aborted ||
      (error instanceof Error && error.name === 'AbortError')
    ) {
      throw abortError()
    }
    throw new TypeError(
      `Proxy request failed (${proxy.redacted}): ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
}

/**
 * Build a `fetch`-compatible function routed through the proxy, honoring
 * NO_PROXY. Requests to bypassed hosts use the global fetch unchanged.
 */
export function createProxyFetch(resolved: ResolvedProxy): typeof fetch {
  const { proxy, noProxy } = resolved
  const useSocks =
    proxy.protocol === 'socks5:' || proxy.protocol === 'socks5h:' || proxy.protocol === 'socks:'
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    try {
      const hostname = new URL(requestUrl(input)).hostname
      if (shouldBypassProxy(hostname, noProxy)) return fetch(input, init)
    } catch {
      return fetch(input, init)
    }
    return useSocks ? socksProxyFetch(proxy, input, init) : axiosProxyFetch(proxy, input, init)
  }) as typeof fetch
}

/**
 * Apply proxy env vars for axios-based SDKs (Tavily / Firecrawl / CRW).
 * Only `http(s)` proxies are applied; axios cannot speak SOCKS.
 */
export function applyAxiosProxyEnv(resolved: ResolvedProxy | null): {
  applied: boolean
  reason: string
} {
  if (!resolved) return { applied: false, reason: 'no proxy configured' }
  const { proxy, noProxy } = resolved
  if (!isAxiosCompatibleProxy(proxy)) {
    return {
      applied: false,
      reason: `${proxy.protocol}// proxy only covers fetch paths (AI, Google PSE, you.com); Tavily/Firecrawl axios SDKs need an http(s) proxy and will connect directly`,
    }
  }
  const auth = proxy.username
    ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password ?? '')}@`
    : ''
  const proxyUrl = `${proxy.protocol}//${auth}${proxy.host}:${proxy.port}`
  for (const name of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy']) {
    process.env[name] = proxyUrl
  }
  for (const name of ['NO_PROXY', 'no_proxy']) {
    process.env[name] = noProxy
  }
  return { applied: true, reason: `axios SDKs via ${proxy.redacted}` }
}

const fetchCache = new Map<string, typeof fetch>()

/** Read proxy env from Nitro runtime config (typegen-safe). */
export function proxyEnvFromRuntimeConfig(runtimeConfig: object): ProxyEnvInput {
  const config = runtimeConfig as Record<string, unknown>
  return {
    proxyUrl: typeof config.proxyUrl === 'string' ? config.proxyUrl : undefined,
    noProxy: typeof config.noProxy === 'string' ? config.noProxy : undefined,
  }
}

/** Cached server proxy fetch from runtime config. Undefined = direct. */
export function getServerProxyFetch(env: ProxyEnvInput): typeof fetch | undefined {
  const resolved = resolveProxyConfig(env)
  if (!resolved) return undefined
  const key = `${resolved.proxy.protocol}//${resolved.proxy.host}:${resolved.proxy.port}:${resolved.proxy.username ?? ''}:${resolved.noProxy}`
  const hit = fetchCache.get(key)
  if (hit) return hit
  const created = createProxyFetch(resolved)
  fetchCache.set(key, created)
  return created
}
