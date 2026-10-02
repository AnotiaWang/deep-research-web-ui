import { researchLearningSchema } from '~~/shared/utils/research-learning'
import { z } from 'zod'
import { createRuntimeId } from '~~/shared/utils/id'
import { researchHistoryGraphSchema } from '~/utils/research-history-graph'
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
  graph: researchHistoryGraphSchema.optional(),
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

export const HISTORY_ITEM_LIMIT = 100

/**
 * Merges persisted history into items created before it finished loading.
 * In-memory items win on ID conflicts because they are the most recent edits.
 */
export function mergeHistoryItems(
  current: ResearchHistoryItem[],
  loaded: ResearchHistoryItem[],
): ResearchHistoryItem[] {
  const ids = new Set(current.map((item) => item.id))
  return [...current, ...loaded.filter((item) => !ids.has(item.id))].slice(0, HISTORY_ITEM_LIMIT)
}

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
    id: options.id ?? createRuntimeId(),
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

function normalizeStoredHistoryItem(item: unknown): ResearchHistoryItem | null {
  const parsed = researchHistoryItemSchema.safeParse(item)
  if (parsed.success) return parsed.data

  // Keep legacy/base fields even if an optional graph payload is malformed.
  if (item && typeof item === 'object' && 'graph' in item) {
    const { graph: _graph, ...rest } = item as Record<string, unknown>
    const withoutGraph = researchHistoryItemSchema.safeParse(rest)
    if (withoutGraph.success) return withoutGraph.data
  }

  return null
}

export function normalizeStoredHistory(value: unknown): ResearchHistory {
  const container = storedHistoryContainerSchema.safeParse(value)
  if (!container.success) return { items: [] }

  return {
    items: container.data.items.flatMap((item) => {
      const normalized = normalizeStoredHistoryItem(item)
      return normalized ? [normalized] : []
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
