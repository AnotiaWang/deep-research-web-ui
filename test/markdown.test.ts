import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createCitationHtml, toSafeHttpUrl } from '../app/utils/markdown.ts'

describe('safe Markdown helpers', () => {
  it('only allows HTTP URLs', () => {
    assert.equal(toSafeHttpUrl('https://example.com/source'), 'https://example.com/source')
    assert.equal(toSafeHttpUrl('http://example.com/source'), 'http://example.com/source')
    assert.equal(toSafeHttpUrl('javascript:alert(1)'), undefined)
    assert.equal(toSafeHttpUrl('data:text/html,malicious'), undefined)
    assert.equal(toSafeHttpUrl('/relative'), undefined)
  })

  it('escapes citation attributes and rejects unsafe links', () => {
    assert.equal(createCitationHtml('[1]', 'javascript:alert(1)', 'Unsafe'), '[1]')
    assert.match(
      createCitationHtml('[1]', 'https://example.com/?q="unsafe"', 'A "quoted" <title>'),
      /href="https:\/\/example\.com\/\?q=%22unsafe%22".*title="A &quot;quoted&quot; &lt;title&gt;"/,
    )
  })
})
