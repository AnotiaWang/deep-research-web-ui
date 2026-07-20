import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveWebSearchApiBase } from '../lib/core/web-search.ts'

describe('resolveWebSearchApiBase', () => {
  it('uses Firecrawl default when apiBase is missing', () => {
    assert.equal(resolveWebSearchApiBase('firecrawl'), 'https://api.firecrawl.dev')
  })

  it('uses fastCRW default when apiBase is missing', () => {
    assert.equal(resolveWebSearchApiBase('crw'), 'https://fastcrw.com/api')
  })

  it('prefers explicit apiBase for Firecrawl-compatible providers', () => {
    assert.equal(resolveWebSearchApiBase('firecrawl', 'https://example.com'), 'https://example.com')
    assert.equal(resolveWebSearchApiBase('crw', 'https://crw.local/api'), 'https://crw.local/api')
  })

  it('returns undefined for providers without a configurable API base', () => {
    assert.equal(resolveWebSearchApiBase('tavily'), undefined)
    assert.equal(resolveWebSearchApiBase('tavily', 'https://ignored.example'), undefined)
    assert.equal(resolveWebSearchApiBase('google-pse'), undefined)
    assert.equal(resolveWebSearchApiBase('google-pse', 'https://www.googleapis.com'), undefined)
  })
})
