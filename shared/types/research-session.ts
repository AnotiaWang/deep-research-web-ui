export type ResearchPhase = 'feedback' | 'research' | 'report'

export type ResearchSessionStatus =
  | 'idle'
  | 'running'
  | 'awaiting-input'
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timed-out'

export interface ResearchInputData {
  query: string
  breadth: number
  depth: number
  numQuestions: number
}

export type ResearchInputSnapshot = Readonly<ResearchInputData>

export interface ResearchFeedbackResult {
  assistantQuestion: string
  userAnswer: string
}

export type ResearchFeedbackSnapshot = Readonly<ResearchFeedbackResult>

export interface ResearchLearning {
  url: string
  title?: string
  learning: string
}

export interface ResearchResult {
  learnings: ResearchLearning[]
}

export interface ResearchFailure {
  phase: ResearchPhase
  code: 'network' | 'http' | 'protocol' | 'upstream' | 'validation' | 'unknown'
  message: string
  retryable: boolean
  httpStatus?: number
}

export interface ResearchSession {
  id: string
  revision: number
  operationId?: string
  historyId?: string
  status: ResearchSessionStatus
  phase?: ResearchPhase
  input?: ResearchInputSnapshot
  feedback?: ReadonlyArray<ResearchFeedbackSnapshot>
  result: ResearchResult
  report: string
  failure?: ResearchFailure
  createdAt?: string
  updatedAt?: string
}

export interface ResearchOperationLease {
  sessionId: string
  operationId: string
  input: ResearchInputSnapshot
  feedback: ReadonlyArray<ResearchFeedbackSnapshot>
  result: ResearchResult
}
