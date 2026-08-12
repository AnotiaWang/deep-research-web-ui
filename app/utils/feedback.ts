import type { ResearchFeedbackResult } from '~~/shared/types/research-session'

export function normalizeFeedbackQuestion(question: unknown) {
  return typeof question === 'string' ? question.trim() : ''
}

export function hasMeaningfulFeedbackQuestions(questions: unknown) {
  if (!Array.isArray(questions)) return false

  return questions.some((question) => {
    if (question && typeof question === 'object' && 'assistantQuestion' in question) {
      return !!normalizeFeedbackQuestion(
        (question as { assistantQuestion?: unknown }).assistantQuestion,
      )
    }
    return !!normalizeFeedbackQuestion(question)
  })
}

export function mergeFeedbackQuestions(
  previous: ResearchFeedbackResult[],
  questions: unknown,
): ResearchFeedbackResult[] {
  const previousItems = Array.isArray(previous) ? previous : []
  if (!Array.isArray(questions)) return previousItems

  const normalizedQuestions = questions
    .map(normalizeFeedbackQuestion)
    .filter((question) => question.length > 0)

  // Partial JSON parsers can emit an empty array/string skeleton while repairing
  // the final stream chunks. Keep the last usable snapshot in that case.
  if (!normalizedQuestions.length) return previousItems

  const answers = new Map(previousItems.map((item) => [item.assistantQuestion, item.userAnswer]))

  return normalizedQuestions.map((assistantQuestion) => ({
    assistantQuestion,
    userAnswer: answers.get(assistantQuestion) ?? '',
  }))
}
