import type { Edge, Node } from '@vue-flow/core'
import { isChildNode } from '~/utils/tree-node'

export function createFlowNode<T>(id: string, data: T): Node<T> {
  return {
    id,
    data,
    position: { x: 0, y: 0 },
    type: 'search',
  }
}

export function createFlowEdge(parentId: string, nodeId: string): Edge {
  return {
    id: `e:${parentId}:${nodeId}`,
    source: parentId,
    target: nodeId,
  }
}

export function removeDescendantFlowElements<
  TNode extends Pick<Node, 'id'>,
  TEdge extends Pick<Edge, 'source' | 'target'>,
>(nodes: TNode[], edges: TEdge[], parentId: string) {
  const descendantIds = new Set(
    nodes.filter((node) => isChildNode(parentId, node.id)).map((node) => node.id),
  )

  return {
    nodes: nodes.filter((node) => !descendantIds.has(node.id)),
    edges: edges.filter(
      (edge) => !descendantIds.has(edge.source) && !descendantIds.has(edge.target),
    ),
  }
}
