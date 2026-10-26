import { z } from 'zod'
import type { ResearchLearning } from '../types/research-session'

/**
 * Bounds for caller-supplied text. The server tokenizes every learning synchronously
 * (`countTokens` in lib/ai/providers.ts), so an unbounded string lets one request block the
 * event loop for seconds. `learning.max` alone allows a ~60k-token prompt, which is well past
 * anything the research flow produces but far from the 40 MiB that stalled the process.
 */
export const researchLearningLimits = {
  url: 2048,
  title: 500,
  learning: 20_000,
  excerpt: 1500,
} as const

export const researchLearningSchema = z.object({
  url: z.string().max(researchLearningLimits.url),
  title: z.string().max(researchLearningLimits.title).optional(),
  learning: z.string().max(researchLearningLimits.learning),
  evidence: z
    .object({
      excerpt: z.string().min(1).max(researchLearningLimits.excerpt),
      retrievedAt: z.string().max(64),
      sourceType: z.enum(['page', 'search-result']),
    })
    .optional(),
})

/** Deduplicate identical findings, never distinct facts from the same page. */
export function deduplicateLearnings(learnings: ResearchLearning[]): ResearchLearning[] {
  const unique = new Map<string, ResearchLearning>()
  for (const learning of learnings) {
    const key = JSON.stringify([learning.url, learning.learning.trim().replace(/\s+/g, ' ')])
    const previous = unique.get(key)
    unique.set(key, { ...previous, ...learning, evidence: learning.evidence ?? previous?.evidence })
  }
  return [...unique.values()].map((learning) => {
    if (!learning.evidence) delete learning.evidence
    return learning
  })
}
