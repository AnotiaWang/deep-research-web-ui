export function normalizeGeneratedSearchQueries<T extends { query?: string }>(
  queries: readonly T[],
  parentNodeId: string,
): Array<T & { query: string; nodeId: string }> {
  return queries.flatMap((query, index) => {
    const value = query.query?.trim()
    if (!value || value === 'undefined') return []
    return [{ ...query, query: value, nodeId: `${parentNodeId}-${index}` }]
  })
}
