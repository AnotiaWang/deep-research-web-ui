import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  createFlowEdge,
  createFlowNode,
  removeDescendantFlowElements,
} from '../app/utils/research-graph.ts'

describe('research graph projection', () => {
  it('creates stable Vue Flow nodes and edges', () => {
    assert.deepEqual(createFlowNode('0-1', { title: 'Query' }), {
      id: '0-1',
      data: { title: 'Query' },
      position: { x: 0, y: 0 },
      type: 'search',
    })
    assert.deepEqual(createFlowEdge('0', '0-1'), {
      id: 'e:0:0-1',
      source: '0',
      target: '0-1',
    })
  })

  it('removes descendants and all connected edges in one projection', () => {
    const nodes = ['0', '0-0', '0-0-0', '0-1'].map((id) => createFlowNode(id, { title: id }))
    const edges = [
      createFlowEdge('0', '0-0'),
      createFlowEdge('0-0', '0-0-0'),
      createFlowEdge('0', '0-1'),
    ]

    const result = removeDescendantFlowElements(nodes, edges, '0-0')

    assert.deepEqual(
      result.nodes.map((node) => node.id),
      ['0', '0-0', '0-1'],
    )
    assert.deepEqual(
      result.edges.map((edge) => edge.id),
      ['e:0:0-0', 'e:0:0-1'],
    )
  })
})
