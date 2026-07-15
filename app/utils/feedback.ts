import type { ResearchFeedbackResult } from '~~/shared/types/research-session'

export function mergeFeedbackQuestions(
  previous: ResearchFeedbackResult[],
  questions: unknown,
): ResearchFeedbackResult[] {
  if (!Array.isArray(questions)) return Array.isArray(previous) ? previous : []

  const answers = new Map(
    (Array.isArray(previous) ? previous : []).map((item) => [
      item.assistantQuestion,
      item.userAnswer,
    ]),
  )

  return questions.flatMap((question) => {
    const assistantQuestion = typeof question === 'string' ? question.trim() : ''
    if (!assistantQuestion) return []
    return [{ assistantQuestion, userAnswer: answers.get(assistantQuestion) ?? '' }]
  })
}
