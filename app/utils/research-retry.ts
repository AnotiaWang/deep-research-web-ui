export function resolveResearchRetryQuery(
  originalQuery: string,
  retryNode: { id: string; label: string },
) {
  return retryNode.id === '0' ? originalQuery : retryNode.label
}
