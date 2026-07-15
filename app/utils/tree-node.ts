export function isChildNode(parentId: string, childId: string) {
  return childId.startsWith(`${parentId}-`)
}

export function isParentNode(parentId: string, childId: string) {
  return isChildNode(parentId, childId)
}

export function isRootNode(nodeId: string) {
  return nodeId === '0' // equal to `nodeDepth(nodeId) === 1`
}

export function parentNodeId(nodeId: string) {
  const segments = nodeId.split('-')
  if (segments.length === 1) return undefined
  return segments.slice(0, -1).join('-')
}

export function nodeIndex(nodeId: string) {
  return parseInt(nodeId.split('-').pop()!)
}

export function nodeDepth(nodeId: string) {
  return nodeId.split('-').length
}

/** Returns the next search breadth at a given node */
export function searchBreadth(initialBreadth: number, nodeId: string) {
  return Math.ceil(initialBreadth / Math.pow(2, nodeDepth(nodeId) - 1))
}
