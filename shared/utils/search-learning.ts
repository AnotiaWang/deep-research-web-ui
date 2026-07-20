type LearningDraft = {
  url?: string
  learning?: string
  title?: string
}

export type FinalizedLearning = {
  url: string
  learning: string
  title?: string
}

/**
 * Keep only learnings whose URL appears in the search results, and attach titles.
 */
export function finalizeLearningsFromSearchResults(
  learnings: LearningDraft[] | undefined,
  results: Array<{ url: string; title?: string }>,
): FinalizedLearning[] {
  if (!learnings?.length) return []

  const allowed = new Map(results.map((result) => [result.url, result.title]))

  return learnings.flatMap((learning) => {
    if (typeof learning.url !== 'string' || typeof learning.learning !== 'string') return []
    if (!allowed.has(learning.url)) return []
    const text = learning.learning.trim()
    if (!text) return []

    return [
      {
        url: learning.url,
        learning: text,
        title: allowed.get(learning.url),
      },
    ]
  })
}

export function escapePromptAttribute(value: string) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}
