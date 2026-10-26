import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DEEDPAGE_MCP_URL, buildReportDocument, publishReportPage } from '../app/utils/deed-page.ts'

function fakeFetch(body: unknown, init: { status?: number; contentType?: string } = {}) {
  const calls: { url: string; init: RequestInit }[] = []
  const fn = (async (url: string, requestInit: RequestInit) => {
    calls.push({ url, init: requestInit })
    const text = typeof body === 'string' ? body : JSON.stringify(body)
    return new Response(text, {
      status: init.status ?? 200,
      headers: { 'content-type': init.contentType ?? 'application/json' },
    })
  }) as unknown as typeof fetch
  return { fn, calls }
}

const site = { url: 'https://quiet-field-a1b2.deed.page/', slug: 'quiet-field-a1b2', token: 't' }
const ok = {
  jsonrpc: '2.0',
  id: 1,
  result: { content: [{ type: 'text', text: JSON.stringify(site) }] },
}

describe('deed.page report publishing', () => {
  it('builds a standalone document with an escaped title', () => {
    const html = buildReportDocument('<script>alert(1)</script> & co', '<p>Body</p>', 'zh')
    assert.match(html, /^<!doctype html>/)
    assert.match(html, /<html lang="zh">/)
    assert.match(html, /<title>&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; co<\/title>/)
    assert.ok(html.includes('<p>Body</p>'))
    assert.ok(!html.includes('<script>'))
    assert.ok(!/src="https?:/.test(html))
  })

  it('calls publish_site with the page and optional expiry', async () => {
    const { fn, calls } = fakeFetch(ok)
    const result = await publishReportPage('<p>x</p>', { ttlSeconds: 3600, fetchFn: fn })
    assert.deepEqual(result, site)
    assert.equal(calls[0]!.url, DEEDPAGE_MCP_URL)
    const request = JSON.parse(String(calls[0]!.init.body))
    assert.equal(request.method, 'tools/call')
    assert.deepEqual(request.params, {
      name: 'publish_site',
      arguments: { files: { 'index.html': '<p>x</p>' }, ttl_seconds: 3600 },
    })
    const headers = calls[0]!.init.headers as Record<string, string>
    assert.equal(headers.Authorization, undefined)
  })

  it('omits ttl_seconds for permanent pages and reads SSE responses', async () => {
    const { fn, calls } = fakeFetch(`event: message\ndata: ${JSON.stringify(ok)}\n\n`, {
      contentType: 'text/event-stream',
    })
    assert.deepEqual(await publishReportPage('<p>x</p>', { fetchFn: fn }), site)
    assert.equal(JSON.parse(String(calls[0]!.init.body)).params.arguments.ttl_seconds, undefined)
  })

  it('surfaces tool, protocol and HTTP errors', async () => {
    const toolError = {
      result: { isError: true, content: [{ type: 'text', text: 'site_too_large' }] },
    }
    await assert.rejects(
      publishReportPage('x', { fetchFn: fakeFetch(toolError).fn }),
      /site_too_large/,
    )
    await assert.rejects(
      publishReportPage('x', { fetchFn: fakeFetch({ error: { message: 'bad request' } }).fn }),
      /bad request/,
    )
    await assert.rejects(
      publishReportPage('x', { fetchFn: fakeFetch('', { status: 503 }).fn }),
      /HTTP 503/,
    )
  })

  it('rejects non-HTTPS page URLs', async () => {
    const bad = {
      result: {
        content: [{ type: 'text', text: JSON.stringify({ ...site, url: 'javascript:alert(1)' }) }],
      },
    }
    await assert.rejects(publishReportPage('x', { fetchFn: fakeFetch(bad).fn }), /invalid page URL/)
  })
})
