import type { ResearchLearning, ResearchResult } from '~~/shared/types/research-session'

export function collectResearchResult(
  results: Array<{ learnings?: Array<Partial<ResearchLearning>> }>,
): ResearchResult {
  const learnings = results
    .flatMap((result) => result.learnings ?? [])
    .filter(
      (learning): learning is ResearchLearning =>
        typeof learning.url === 'string' && typeof learning.learning === 'string',
    )

  return {
    learnings: [...new Map(learnings.map((learning) => [learning.url, learning])).values()],
  }
}
