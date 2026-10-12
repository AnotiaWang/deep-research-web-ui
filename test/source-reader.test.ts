import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createSourceReader, sourceReadLimits } from '../lib/core/read-source.ts'
import { buildSourcePrompt, selectSourcePassages } from '../lib/core/source-context.ts'
import { countTokens } from '../lib/ai/providers.ts'
import { finalizeLearningsFromSearchResults } from '../shared/utils/search-learning.ts'
import { researchRequestSchema } from '../shared/utils/research-input.ts'

const url = 'https://example.com/launch'

describe('operation-scoped source reader', () => {
  it('deduplicates concurrent URLs, preserves citation identities and reuses search page bodies', async () => {
    let calls = 0
    const reader = createSourceReader(async () => {
      calls++
      await new Promise((resolve) => setTimeout(resolve, 5))
      return { url: 'https://example.com/new', content: 'Official page contents' }
    })
    const results = await Promise.all([
      reader.read({ url }),
      reader.read({ url: url + '#details' }),
    ])
    assert.equal(calls, 1)
    assert.equal(results[0]?.url, url)
    assert.equal(results[1]?.url, url + '#details')
    assert.equal(results[0]?.finalUrl, 'https://example.com/new')
    assert.equal(
      (await reader.read({ url: 'https://example.com/new' }))?.url,
      'https://example.com/new',
    )
    assert.equal(calls, 1)
    reader.remember([
      { url: 'https://example.com/cached', content: 'Search supplied page', sourceType: 'page' },
    ])
    assert.equal(
      (await reader.read({ url: 'https://example.com/cached' }))?.content,
      'Search supplied page',
    )
    assert.equal(calls, 1)
  })

  it('bounds concurrent requests and total attempts, including failures, across branches', async () => {
    let calls = 0,
      active = 0,
      peak = 0
    const reader = createSourceReader(async () => {
      calls++
      active++
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active--
      throw new Error('Unreadable page')
    })
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => reader.read({ url: `${url}/${i}` })),
    )
    assert.ok(results.every((result) => !result))
    assert.equal(calls, sourceReadLimits.perRun)
    assert.equal(peak, sourceReadLimits.concurrency)
    await reader.read({ url: `${url}/0` })
    assert.equal(calls, sourceReadLimits.perRun)
  })

  it('propagates cancellation to active reads and never starts queued reads afterward', async () => {
    const controller = new AbortController()
    const signals: AbortSignal[] = []
    const reader = createSourceReader(async (_url, { signal }) => {
      signals.push(signal!)
      if (signals.length === 2) queueMicrotask(() => controller.abort())
      return new Promise(() => {})
    }, controller.signal)
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, (_, i) => reader.read({ url: `${url}/${i}` })),
    )
    assert.equal(signals.length, 2)
    assert.ok(signals.every((signal) => signal.aborted))
    assert.ok(
      results.every(
        (result) => result.status === 'rejected' && result.reason.name === 'AbortError',
      ),
    )
  })

  it('does not read unsupported protocols, embedded credentials or unavailable providers', async () => {
    let calls = 0
    const reader = createSourceReader(async () => {
      calls++
      return undefined
    })
    for (const url of [
      'file:///etc/passwd',
      'javascript:alert(1)',
      'https://user:pass@example.com',
      'invalid',
    ])
      assert.equal(await reader.read({ url }), undefined)
    assert.equal(calls, 0)
    assert.equal(createSourceReader().available, false)
    assert.equal(await createSourceReader().read({ url }), undefined)
    const input = { query: 'research', breadth: 1, depth: 1, languageCode: 'en' }
    assert.equal(
      researchRequestSchema.safeParse({ ...input, sourceUrls: ['file:///etc/passwd'] }).success,
      false,
    )
    assert.deepEqual(researchRequestSchema.parse({ ...input, sourceUrls: [url] }).sourceUrls, [url])
  })
})

describe('source evidence context', () => {
  it('matches excerpts against the actual snippet or page version without splicing them', () => {
    const sources = [
      { url, content: 'Search-only excerpt with details.', sourceType: 'search-result' as const },
      { url, content: 'Page-only excerpt with more details.', sourceType: 'page' as const },
    ]
    const result = finalizeLearningsFromSearchResults(
      sources.map((source) => ({ url, learning: 'Supported finding', quote: source.content })),
      sources,
    )
    assert.deepEqual(
      result.map((item) => item.evidence?.sourceType),
      ['search-result', 'page'],
    )
    assert.equal(
      finalizeLearningsFromSearchResults(
        [{ url, learning: 'Spliced', quote: sources.map((s) => s.content).join(' ') }],
        sources,
      )[0]?.evidence,
      undefined,
    )
  })

  it('allocates a total prompt budget and retains relevant original passages near a page end', () => {
    const content =
      'Irrelevant boilerplate content.\n'.repeat(1000) +
      '\nQuasar pricing is 17 dollars per month.\n'
    const selected = selectSourcePassages(content, 'Quasar pricing', 120)
    assert.match(selected, /Quasar pricing is 17 dollars per month/)
    assert.ok(countTokens(selected) <= 120)
    const system = 'Extract original quotes.'
    const prompt = buildSourcePrompt({
      contents: Array(5).fill(content),
      query: 'Quasar pricing',
      system,
      contextSize: 2400,
      render: (parts) =>
        `Instructions\n${parts.map((part, i) => `<source id="${i}">${part}</source>`).join('\n')}\nJSON schema`,
    })
    assert.equal((prompt.match(/Quasar pricing is 17/g) ?? []).length, 5)
    // The default output reserve is a quarter of this small context
    assert.ok(countTokens(prompt) + countTokens(system) + 600 + 128 <= 2400)
    assert.throws(
      () =>
        buildSourcePrompt({
          contents: ['x'],
          query: '',
          system,
          contextSize: 100,
          render: () => 'Instructions'.repeat(1000),
        }),
      /context budget/,
    )
  })

  it('reserves output for reasoning and a tokenizer margin without capping the request', () => {
    const content = 'Relevant research evidence sentence.\n'.repeat(2000)
    const build = (maxOutputTokens?: number) =>
      countTokens(
        buildSourcePrompt({
          contents: [content, content],
          query: 'research evidence',
          system: 'system',
          contextSize: 16_000,
          maxOutputTokens,
          render: (parts) => parts.map((part) => `<source>${part}</source>`).join('\n'),
        }),
      )
    // Default reserve: min(32k, a quarter of the context), then a 10% margin
    const byDefault = build()
    assert.ok(byDefault <= (16_000 - 4_000) * 0.9 && byDefault > (16_000 - 4_000) * 0.7)
    // A configured cap is reserved exactly
    const capped = build(1_000)
    assert.ok(capped <= (16_000 - 1_000) * 0.9 && capped > byDefault)
    assert.throws(() => build(16_000), /context budget/)
  })
})

it('retains relevant passages inside an unbroken page and segments Chinese questions', () => {
  const unbroken =
    'irrelevant '.repeat(400) + 'Needle123 is the required detail. ' + 'boilerplate '.repeat(400)
  assert.match(selectSourcePassages(unbroken, 'Needle123', 400), /Needle123/)
  const chinese = '无关的页面导航。\n'.repeat(500) + '量子计算的最新研究详情。\n'
  assert.match(selectSourcePassages(chinese, '量子计算有哪些进展', 100), /量子计算/)
})
