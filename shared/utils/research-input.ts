import { z } from 'zod'

export const researchInputLimits = {
  numQuestions: { min: 1, max: 5 },
  depth: { min: 1, max: 8 },
  breadth: { min: 1, max: 8 },
} as const

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
  .extend({ language: requiredText })
  .passthrough()

export const researchRequestSchema = researchInputSchema
  .pick({ query: true, breadth: true, depth: true })
  .extend({
    languageCode: supportedLocale,
    searchLanguageCode: supportedLocale.optional(),
    /** Root user goal preserved when retrying or recursing with a narrowed query */
    originalQuery: z.string().trim().min(1).optional(),
    learnings: z
      .array(
        z.object({
          url: z.string(),
          learning: z.string(),
        }),
      )
      .default([]),
    currentDepth: boundedInteger(
      researchInputLimits.depth.min,
      researchInputLimits.depth.max,
    ).default(1),
    nodeId: z.string().default('0'),
    retryNode: z.unknown().optional(),
  })
  .passthrough()

export type ValidatedResearchInput = z.infer<typeof researchInputSchema>
