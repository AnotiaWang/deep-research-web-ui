import { z } from 'zod'

export const researchInputLimits = {
  numQuestions: { min: 1, max: 5 },
  depth: { min: 1, max: 8 },
  breadth: { min: 1, max: 8 },
} as const

const requiredText = z.string().trim().min(1)
const supportedLocale = z.enum(['en', 'zh', 'nl'])
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
