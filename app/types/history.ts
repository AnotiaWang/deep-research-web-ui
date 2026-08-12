import type { ResearchFeedbackResult, ResearchLearning } from '~~/shared/types/research-session'

export type ResearchHistoryNodeStatus =
  | 'generating_query'
  | 'generating_query_reasoning'
  | 'generated_query'
  | 'searching'
  | 'search_complete'
  | 'processing_search_result'
  | 'processing_search_result_reasoning'
  | 'node_complete'
  | 'error'

export interface ResearchHistoryGraphNode {
  id: string
  label: string
  researchGoal?: string
  generateQueriesReasoning?: string
  generateLearningsReasoning?: string
  searchResults?: Array<{ url: string; title?: string }>
  learnings?: ResearchLearning[]
  status?: ResearchHistoryNodeStatus
  error?: string
}

export interface ResearchHistoryGraph {
  nodes: ResearchHistoryGraphNode[]
  selectedNodeId?: string
}

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
  /** Optional for backward compatibility with older history exports. */
  graph?: ResearchHistoryGraph
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
