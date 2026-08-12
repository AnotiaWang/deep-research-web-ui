import type { ResearchFeedbackResult, ResearchInputData } from '~~/shared/types/research-session'

export function getCombinedQuery(form: ResearchInputData, feedback: ResearchFeedbackResult[]) {
  const answered = feedback.filter((qa) => qa.assistantQuestion?.trim() && qa.userAnswer?.trim())

  if (!answered.length) {
    return `Initial Query: ${form.query}`
  }

  return `Initial Query: ${form.query}
Follow-up Questions and Answers:
${answered.map((qa) => `Q: ${qa.assistantQuestion}\nA: ${qa.userAnswer}`).join('\n')}`
}
