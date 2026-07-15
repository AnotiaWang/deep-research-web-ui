import type { ResearchFeedbackResult, ResearchLearning } from '~~/shared/types/research-session'

export interface ResearchHistoryItem {
  id: string
  title: string
  query: string
  breadth: number
  depth: number
  numQuestions: number
  feedback: ResearchFeedbackResult[]
  learnings: ResearchLearning[]
  report: string
  createdAt: string
  updatedAt: string
}

export type NewResearchHistoryItem = Omit<ResearchHistoryItem, 'id' | 'createdAt' | 'updatedAt'>

export type ResearchHistoryItemUpdates = Partial<
  Omit<ResearchHistoryItem, 'id' | 'createdAt' | 'updatedAt'>
>

export interface ResearchHistory {
  items: ResearchHistoryItem[]
}
