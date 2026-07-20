import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  collectSearchResultsFromHistoryNodes,
  createResearchHistoryGraph,
  projectFlowFromHistoryNodes,
  researchHistoryGraphSchema,
  restoreResearchHistoryGraph,
  serializeResearchHistoryNode,
} from '../app/utils/research-history-graph.ts'
import {
  createResearchHistoryItem,
  normalizeStoredHistory,
  parseImportedHistoryItem,
} from '../app/utils/history.ts'

const sampleNodes = [
  { id: '0', label: 'Start', status: 'node_complete' as const },
  {
    id: '0-0',
    label: 'What is Vue?',
    researchGoal: 'Understand Vue basics',
    generateLearningsReasoning: 'thinking...',
    searchResults: [
      {
        url: 'https://vuejs.org',
        title: 'Vue',
        content: 'huge page body that should not be persisted',
      },
    ],
    learnings: [{ url: 'https://vuejs.org', title: 'Vue', learning: 'Vue is a framework' }],
    status: 'node_complete' as const,
  },
  {
    id: '0-0-0',
    label: 'Vue reactivity',
    researchGoal: 'Dig into reactivity',
    status: 'error' as const,
    error: 'search failed',
  },
]

describe('research history graph', () => {
  it('serializes nodes without search result content', () => {
    const graph = createResearchHistoryGraph(sampleNodes, '0-0')

    assert.equal(graph.selectedNodeId, '0-0')
    assert.deepEqual(graph.nodes[1]?.searchResults, [{ url: 'https://vuejs.org', title: 'Vue' }])
    assert.equal(
      serializeResearchHistoryNode(sampleNodes[1]!).searchResults?.[0] &&
        'content' in serializeResearchHistoryNode(sampleNodes[1]!).searchResults![0]!,
      false,
    )
  })

  it('projects flow nodes/edges and restores a usable graph snapshot', () => {
    const graph = createResearchHistoryGraph(sampleNodes, '0-0')
    const { flowNodes, flowEdges } = projectFlowFromHistoryNodes(graph.nodes)
    const restored = restoreResearchHistoryGraph(graph)

    assert.deepEqual(
      flowNodes.map((node) => node.id),
      ['0', '0-0', '0-0-0'],
    )
    assert.deepEqual(
      flowEdges.map((edge) => edge.id),
      ['e:0:0-0', 'e:0-0:0-0-0'],
    )
    assert.equal(restored.selectedNodeId, '0-0')
    assert.deepEqual(restored.searchResults['0-0']?.learnings, sampleNodes[1]!.learnings)
    assert.equal(restored.nodes[2]?.error, 'search failed')
  })

  it('drops invalid selectedNodeId and rebuilds searchResults from learnings', () => {
    const graph = createResearchHistoryGraph(sampleNodes, 'missing-node')
    const restored = restoreResearchHistoryGraph(graph)
    const searchResults = collectSearchResultsFromHistoryNodes(graph.nodes)

    assert.equal(restored.selectedNodeId, undefined)
    assert.deepEqual(Object.keys(searchResults), ['0-0'])
  })

  it('accepts graph in history schema and keeps legacy items without graph', () => {
    const withGraph = createResearchHistoryItem({
      title: 'Vue',
      query: 'Vue',
      breadth: 2,
      depth: 2,
      numQuestions: 3,
      feedback: [],
      learnings: [{ url: 'https://vuejs.org', learning: 'Vue is a framework' }],
      report: '# Report',
      graph: createResearchHistoryGraph(sampleNodes),
    })
    const withoutGraph = createResearchHistoryItem({
      title: 'Legacy',
      query: 'Legacy',
      breadth: 2,
      depth: 2,
      numQuestions: 3,
      feedback: [],
      learnings: [],
      report: '',
    })

    assert.equal(researchHistoryGraphSchema.safeParse(withGraph.graph).success, true)
    assert.deepEqual(normalizeStoredHistory({ items: [withGraph, withoutGraph] }).items, [
      withGraph,
      withoutGraph,
    ])
    assert.deepEqual(parseImportedHistoryItem(withGraph).graph?.nodes[1]?.label, 'What is Vue?')
  })

  it('keeps history items when optional graph payload is malformed', () => {
    const base = createResearchHistoryItem({
      title: 'Broken graph',
      query: 'Broken graph',
      breadth: 2,
      depth: 2,
      numQuestions: 3,
      feedback: [],
      learnings: [],
      report: '',
    })
    const normalized = normalizeStoredHistory({
      items: [{ ...base, graph: { nodes: [] } }],
    })

    assert.equal(normalized.items.length, 1)
    assert.equal(normalized.items[0]?.id, base.id)
    assert.equal(normalized.items[0]?.graph, undefined)
  })
})
