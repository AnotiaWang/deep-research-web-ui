import { searchConstraintsSchema } from '~~/shared/utils/search-plan'
import { z } from 'zod'
import { isReadableUrl } from '~~/shared/utils/source-url'
import { researchLearningSchema } from '~~/shared/utils/research-learning'

export const researchInputLimits = {
  numQuestions: { min: 1, max: 5 },
  depth: { min: 1, max: 8 },
  breadth: { min: 1, max: 8 },
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

const requiredText = z.string().trim().min(1)
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
  query: requiredText,
  numQuestions: boundedInteger(
    researchInputLimits.numQuestions.min,
    researchInputLimits.numQuestions.max,
  ),
  depth: boundedInteger(researchInputLimits.depth.min, researchInputLimits.depth.max),
  breadth: boundedInteger(researchInputLimits.breadth.min, researchInputLimits.breadth.max),
})

export const feedbackRequestSchema = researchInputSchema
  .pick({ query: true, numQuestions: true })
  .extend({ language: requiredText, suggestResearchMode: z.boolean().optional() })
  .passthrough()

export const researchRequestSchema = researchInputSchema
  .pick({ query: true, breadth: true, depth: true })
  .extend({
    languageCode: supportedLocale,
    searchLanguageCode: supportedLocale.optional(),
    searchConstraints: searchConstraintsSchema.optional(),
    sourceUrls: z.array(z.string().max(4096).refine(isReadableUrl)).max(2).optional(),
    /** Root user goal preserved when retrying or recursing with a narrowed query */
    originalQuery: z.string().trim().min(1).optional(),
    learnings: z.array(researchLearningSchema).default([]),
    currentDepth: boundedInteger(
      researchInputLimits.depth.min,
      researchInputLimits.depth.max,
    ).default(1),
    nodeId: z.string().default('0'),
    retryNode: z.unknown().optional(),
  })
  .passthrough()

export type ValidatedResearchInput = z.infer<typeof researchInputSchema>
