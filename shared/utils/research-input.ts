import { searchConstraintsSchema, searchPlanSchema } from '~~/shared/utils/search-plan'
import { z } from 'zod'
import { isReadableUrl } from '~~/shared/utils/source-url'
import { researchLearningSchema } from '~~/shared/utils/research-learning'

export const researchInputLimits = {
  numQuestions: { min: 1, max: 5 },
  depth: { min: 1, max: 8 },
  breadth: { min: 1, max: 8 },
  /**
   * Accumulated findings replayed into a retry. The client sends every ancestor node's learnings,
   * and the server tokenizes them synchronously before the request starts, so this bounds both
   * the prompt and the event-loop cost. Each entry is itself capped by `researchLearningLimits`.
   */
  learnings: 500,
} as const

export const researchPresets = {
  quick: { breadth: 2, depth: 1 },
  standard: { breadth: 2, depth: 2 },
  deep: { breadth: 4, depth: 3 },
} as const

export type ResearchPreset = keyof typeof researchPresets
export type ResearchDepthSettings = { breadth: number; depth: number }

export const researchPresetKeys = Object.keys(researchPresets) as [
  ResearchPreset,
  ...ResearchPreset[],
]

export function isResearchPreset(value: unknown): value is ResearchPreset {
  return typeof value === 'string' && Object.hasOwn(researchPresets, value)
}

export function findResearchPreset(input: {
  breadth: unknown
  depth: unknown
}): ResearchPreset | undefined {
  return researchPresetKeys.find(
    (key) =>
      Number(input.breadth) === researchPresets[key].breadth &&
      Number(input.depth) === researchPresets[key].depth,
  )
}

/**
 * Upper bound of planned search queries: each level spawns `ceil(breadth / 2)`
 * follow-up queries per node, mirroring `deepResearch` in lib/core/deep-research.ts.
 */
export function estimateMaxSearches(breadth: number, depth: number) {
  let width = breadth
  let nodes = breadth
  let total = 0
  for (let level = 1; level <= depth; level++) {
    total += nodes
    width = Math.ceil(width / 2)
    nodes *= width
  }
  return total
}

/**
 * Ceilings for caller-supplied text. Every value here is later interpolated into a prompt that the
 * server pays for, and `query`/`originalQuery` are re-sent on each recursive branch, so an
 * unbounded string would be multiplied by the whole research tree.
 */
export const researchRequestLimits = {
  query: 4_000,
  originalQuery: 8_000,
  language: 64,
  nodeId: 128,
} as const

const boundedText = (max: number) => z.string().trim().min(1).max(max)
const SUPPORTED_LOCALES = ['en', 'zh', 'nl', 'ko'] as const

/**
 * Browsers/OSes commonly report region-qualified locales such as `en-US`,
 * `zh-CN`, `nl_NL` or `ko-KR` (e.g. via `navigator.language` or the `Accept-Language`
 * header). Normalize these to their base language so requests aren't
 * rejected just because a region suffix is present.
 */
function normalizeLocale(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const base = value.trim().split(/[-_]/)[0]?.toLowerCase()
  return base ?? value
}

const supportedLocale = z.preprocess(normalizeLocale, z.enum(SUPPORTED_LOCALES))
const boundedInteger = (min: number, max: number) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() !== '' ? Number(value.trim()) : value),
    z.number().int().min(min).max(max),
  )

export const researchInputSchema = z.object({
  query: boundedText(researchRequestLimits.query),
  numQuestions: boundedInteger(
    researchInputLimits.numQuestions.min,
    researchInputLimits.numQuestions.max,
  ),
  depth: boundedInteger(researchInputLimits.depth.min, researchInputLimits.depth.max),
  breadth: boundedInteger(researchInputLimits.breadth.min, researchInputLimits.breadth.max),
})

export const feedbackRequestSchema = researchInputSchema
  .pick({ query: true, numQuestions: true })
  .extend({
    language: boundedText(researchRequestLimits.language),
    suggestResearchMode: z.boolean().optional(),
  })
  // Strict: passthrough let an unknown key ride along into the handler for no benefit.
  .strict()

export const researchRequestSchema = researchInputSchema
  .pick({ query: true, breadth: true, depth: true })
  .extend({
    languageCode: supportedLocale,
    searchLanguageCode: supportedLocale.optional(),
    searchConstraints: searchConstraintsSchema.optional(),
    sourceUrls: z.array(z.string().max(4096).refine(isReadableUrl)).max(2).optional(),
    /** Root user goal preserved when retrying or recursing with a narrowed query */
    originalQuery: boundedText(researchRequestLimits.originalQuery).optional(),
    learnings: z.array(researchLearningSchema).max(researchInputLimits.learnings).default([]),
    currentDepth: boundedInteger(
      researchInputLimits.depth.min,
      researchInputLimits.depth.max,
    ).default(1),
    nodeId: z.string().max(researchRequestLimits.nodeId).default('0'),
    // Only `id`, `label`, `researchGoal` and `searchPlan` are read downstream; anything else was
    // forwarded untouched from an untrusted body into the recursive search path.
    retryNode: z
      .object({
        id: z.string().max(researchRequestLimits.nodeId),
        label: z.string().max(researchRequestLimits.query),
        researchGoal: z.string().max(researchRequestLimits.query).optional(),
        searchPlan: searchPlanSchema.partial().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()

export type ValidatedResearchInput = z.infer<typeof researchInputSchema>
