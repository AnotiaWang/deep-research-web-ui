import { z } from 'zod'
import type {
  NewResearchHistoryItem,
  ResearchHistory,
  ResearchHistoryItem,
  ResearchHistoryItemUpdates,
} from '~/types/history'

const researchFeedbackSchema = z.object({
  assistantQuestion: z.string(),
  userAnswer: z.string(),
})

const researchLearningSchema = z.object({
  url: z.string(),
  title: z.string().optional(),
  learning: z.string(),
})

export const researchHistoryItemSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  query: z.string().min(1),
  breadth: z.number().int().positive(),
  depth: z.number().int().positive(),
  numQuestions: z.number().int().positive(),
  feedback: z.array(researchFeedbackSchema),
  learnings: z.array(researchLearningSchema),
  report: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const importedResearchHistoryItemSchema = researchHistoryItemSchema.extend({
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
})

const storedHistoryContainerSchema = z.object({
  items: z.array(z.unknown()),
})

interface CreateResearchHistoryItemOptions {
  id?: string
  timestamp?: string
}

export function createResearchHistoryItem(
  item: NewResearchHistoryItem,
  options: CreateResearchHistoryItemOptions = {},
): ResearchHistoryItem {
  const timestamp = options.timestamp ?? new Date().toISOString()
  return {
    ...item,
    id: options.id ?? crypto.randomUUID(),
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

export function updateResearchHistoryItem(
  items: ResearchHistoryItem[],
  id: string,
  updates: ResearchHistoryItemUpdates,
  timestamp = new Date().toISOString(),
) {
  const existing = items.find((item) => item.id === id)
  if (!existing) return null
  return {
    ...existing,
    ...updates,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: timestamp,
  } satisfies ResearchHistoryItem
}

export function normalizeStoredHistory(value: unknown): ResearchHistory {
  const container = storedHistoryContainerSchema.safeParse(value)
  if (!container.success) return { items: [] }

  return {
    items: container.data.items.flatMap((item) => {
      const parsed = researchHistoryItemSchema.safeParse(item)
      return parsed.success ? [parsed.data] : []
    }),
  }
}

export function parseImportedHistoryItem(
  value: unknown,
  timestamp = new Date().toISOString(),
): ResearchHistoryItem {
  const parsed = importedResearchHistoryItemSchema.safeParse(value)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const path = issue?.path.join('.')
    throw new Error(
      `Invalid history item format${path ? ` at ${path}` : ''}${issue ? `: ${issue.message}` : ''}`,
    )
  }

  return {
    ...parsed.data,
    createdAt: parsed.data.createdAt ?? timestamp,
    updatedAt: timestamp,
  }
}
