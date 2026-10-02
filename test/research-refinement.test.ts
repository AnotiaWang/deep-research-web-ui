import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createRefinementGraph, runResearchRefinement } from '../app/utils/research-refinement.ts'
import { restoreResearchHistoryGraph } from '../app/utils/research-history-graph.ts'
import { collectResearchResult } from '../app/utils/research-result.ts'
import {
  createInitialResearchSession,
  researchSessionReducer,
  canRegenerateReportFromSession,
} from '../app/utils/research-session-reducer.ts'

const finding = {
  url: 'https://example.com/pricing',
  learning: 'Price is 12',
  evidence: {
    excerpt: 'The current price is 12 per month.',
    sourceType: 'page' as const,
    retrievedAt: '2026-09-07T00:00:00Z',
  },
}
const result = { learnings: [{ url: 'https://example.com/old', learning: 'Price is 10' }] }
const report =
  'Price is 10 [1].\n\nKeep this paragraph unchanged.\n\n## Sources\n\n1. [Old](https://example.com/old)'
const base = {
  request: { learningIndex: 0, instruction: 'Check the latest price' },
  originalQuery: 'Compare pricing',
  result,
  report,
  languageCode: 'en',
  aiConfig: { provider: 'openai-compatible', model: 'test', contextSize: 128000 },
  onStage: () => {},
}

function services(overrides: Record<string, unknown> = {}) {
  return {
    async deepResearch(params: any) {
      assert.deepEqual(params.sourceUrls, [result.learnings[0]!.url])
      assert.equal(params.breadth, 2)
      assert.equal(params.maxDepth, 1)
      assert.equal(params.learnings, undefined)
      params.onProgress({ type: 'reading_source', nodeId: '0-0' })
      params.onProgress({ type: 'searching', nodeId: '0-0', query: 'pricing' })
      params.onProgress({ type: 'complete', learnings: [finding] })
    },
    async writeFinalReport(params: any) {
      assert.equal(params.revision.firstNewCitation, 2)
      return {
        fullStream: (async function* () {
          yield {
            type: 'text-delta',
            textDelta: JSON.stringify({
              patches: params.revision.blocks.map((block: any) => ({
                id: block.id,
                markdown: 'Price is 12 [2].',
              })),
            }),
          }
        })(),
      }
    },
    ...overrides,
  } as any
}

describe('research follow-up transaction', () => {
  it('keeps legacy findings after refinement, history restoration and a node retry', () => {
    for (const originalGraph of [undefined, { nodes: [{ id: '0', label: 'Start' }] }]) {
      const snapshot = structuredClone(originalGraph)
      const graph = createRefinementGraph({
        graph: originalGraph,
        query: base.originalQuery,
        result,
        findings: [finding],
        request: base.request,
      })
      const restored = restoreResearchHistoryGraph(JSON.parse(JSON.stringify(graph)))
      const followUpNode = graph.nodes.find((node) => node.id !== '0')!
      // Retrying the follow-up replaces only its findings; the legacy report survives.
      const retried = { ...finding, learning: 'Price is now 14' }
      restored.searchResults[followUpNode.id] = { learnings: [retried] }
      assert.deepEqual(collectResearchResult(Object.values(restored.searchResults)), {
        learnings: [...result.learnings, retried],
      })
      assert.deepEqual(originalGraph, snapshot)
    }
  })

  it('fills missing graph evidence without duplicating findings owned by existing nodes', () => {
    const existing = {
      nodes: [
        { id: '0', label: 'Start' },
        { id: '0-3', label: 'Existing search', learnings: result.learnings },
      ],
      selectedNodeId: '0-3',
    }
    const snapshot = structuredClone(existing)
    const missing = { url: result.learnings[0]!.url, learning: 'Another fact from the same page' }
    const graph = createRefinementGraph({
      graph: existing,
      query: base.originalQuery,
      result: { learnings: [...result.learnings, missing] },
      findings: [finding],
      request: base.request,
    })
    assert.deepEqual(graph.nodes[0]?.learnings, [missing])
    assert.deepEqual(graph.nodes[1]?.learnings, result.learnings)
    assert.equal(graph.nodes[2]?.id, '0-4')
    assert.equal(graph.selectedNodeId, '0-3')
    const restored = restoreResearchHistoryGraph(JSON.parse(JSON.stringify(graph)))
    assert.equal(collectResearchResult(Object.values(restored.searchResults)).learnings.length, 3)
    assert.deepEqual(existing, snapshot)
  })

  it('searches a bounded question, patches only cited blocks and appends evidence', async () => {
    const stages: string[] = []
    const outcome = await runResearchRefinement({
      ...base,
      services: services(),
      onStage: (stage) => stages.push(stage),
    } as any)
    assert.deepEqual(stages, ['searching', 'reading', 'searching', 'revising'])
    assert.equal(outcome.result.learnings.length, 2)
    assert.deepEqual(outcome.result.learnings[1].evidence, finding.evidence)
    assert.match(outcome.report, /^Price is 12 \[2\]/)
    assert.ok(outcome.report.includes('Keep this paragraph unchanged.'))
    assert.match(outcome.report, /2\. \[https:\/\/example.com\/pricing\]/)
    assert.equal(result.learnings.length, 1)
    assert.match(report, /^Price is 10/)
  })

  it('preserves existing citation positions even for duplicate legacy findings', async () => {
    const legacy = { learnings: [...result.learnings, ...result.learnings] }
    const outcome = await runResearchRefinement({
      ...base,
      result: legacy,
      services: services({
        async writeFinalReport(params: any) {
          assert.equal(params.learnings.length, 3)
          return {
            fullStream: (async function* () {
              yield {
                type: 'text-delta',
                textDelta: JSON.stringify({
                  patches: params.revision.blocks.map((block: any) => ({
                    id: block.id,
                    markdown: 'Price is 12 [3].',
                  })),
                }),
              }
            })(),
          }
        },
      }),
    } as any)
    assert.deepEqual(outcome.result.learnings.slice(0, 2), legacy.learnings)
  })

  it('does not update a report without matched excerpts or a completion event', async () => {
    for (const emit of [false, true]) {
      await assert.rejects(
        runResearchRefinement({
          ...base,
          services: services({
            async deepResearch(params: any) {
              if (emit) params.onProgress({ type: 'complete', learnings: result.learnings })
            },
            async writeFinalReport() {
              assert.fail('Must not revise without evidence')
            },
          }),
        } as any),
        /No matching source/,
      )
    }
  })

  it('rejects malformed patches and cancellation without mutating original data', async () => {
    await assert.rejects(
      runResearchRefinement({
        ...base,
        services: services({
          async writeFinalReport() {
            return {
              fullStream: (async function* () {
                yield { type: 'text-delta', textDelta: '{"patches":[' }
              })(),
            }
          },
        }),
      } as any),
    )
    const controller = new AbortController()
    await assert.rejects(
      runResearchRefinement({
        ...base,
        signal: controller.signal,
        services: services({
          async deepResearch(params: any) {
            params.onProgress({ type: 'complete', learnings: [finding] })
            controller.abort()
          },
          async writeFinalReport() {
            assert.fail('Must not revise after cancellation')
          },
        }),
      } as any),
      { name: 'AbortError' },
    )
    assert.equal(result.learnings.length, 1)
  })

  it('commits report, findings and history together, ignoring a stale completion', () => {
    const running = {
      ...createInitialResearchSession(),
      id: 's',
      operationId: 'o',
      status: 'running' as const,
      phase: 'research' as const,
      result,
      report,
    }
    const event = {
      type: 'REFINEMENT_SUCCEEDED' as const,
      sessionId: 's',
      operationId: 'o',
      report: 'New report',
      result: { learnings: [finding] },
      historyId: 'new-history',
      at: '2026-09-07',
    }
    const done = researchSessionReducer(running, event)
    assert.equal(done.status, 'completed')
    assert.equal(done.report, 'New report')
    assert.equal(done.historyId, 'new-history')
    assert.deepEqual(done.result.learnings[0].evidence, finding.evidence)
    assert.equal(researchSessionReducer({ ...running, status: 'cancelled' }, event).report, report)
    assert.equal(
      canRegenerateReportFromSession({
        ...running,
        status: 'cancelled',
        historyId: 'original',
        input: { query: 'Pricing', breadth: 2, depth: 2, numQuestions: 3 },
      }),
      true,
    )
    assert.equal(researchSessionReducer(running, { ...event, operationId: 'old' }), running)
  })
})
