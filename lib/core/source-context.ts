import { countTokens, promptTokenBudget } from '~~/lib/ai/providers'

const omitted = '\n[... source text omitted ...]\n'

/** Select original passages, never generated summaries, within one shared prompt budget. */
export function selectSourcePassages(content: string, query: string, budget: number): string {
  if (budget <= 0) return ''
  if (countTokens(content) <= budget) return content
  const words =
    typeof Intl.Segmenter === 'function'
      ? [...new Intl.Segmenter(undefined, { granularity: 'word' }).segment(query.toLowerCase())]
          .filter((part) => part.isWordLike && part.segment.length > 1)
          .map((part) => part.segment)
      : (query.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [])
  const terms = [...new Set(words)]
  // Bounded passages also handle a page with no paragraph breaks.
  const passages = [...content.matchAll(/[^\n]{1,1200}(?:\n|$)?/g)].map((match, index) => ({
    text: match[0],
    index,
    score: terms.reduce((score, term) => score + Number(match[0].toLowerCase().includes(term)), 0),
  }))
  const selected: typeof passages = []
  let remaining = budget - countTokens(omitted) * 2
  for (const passage of passages.sort((a, b) => b.score - a.score || a.index - b.index)) {
    const cost = countTokens(passage.text) + countTokens(omitted)
    if (cost <= remaining) {
      selected.push(passage)
      remaining -= cost
    }
  }
  if (!selected.length && passages.length && remaining > 0) {
    const text = passages[0]!.text
    let low = 0,
      high = text.length
    while (low < high) {
      const mid = Math.ceil((low + high) / 2)
      if (countTokens(text.slice(0, mid)) <= remaining) low = mid
      else high = mid - 1
    }
    if (low) selected.push({ ...passages[0]!, text: text.slice(0, low) })
  }
  const result =
    omitted +
    selected
      .sort((a, b) => a.index - b.index)
      .map((p) => p.text)
      .join(omitted) +
    omitted
  return countTokens(result) <= budget ? result : ''
}

export function buildSourcePrompt(options: {
  contents: string[]
  query: string
  contextSize?: number
  /** Configured output cap; reserved exactly when set */
  maxOutputTokens?: number
  system: string
  render: (contents: string[]) => string
}) {
  // Account for ALL instructions/metadata first.
  const limit = promptTokenBudget(options)
  const overhead = countTokens(options.render(options.contents.map(() => '')))
  if (overhead >= limit) throw new Error('Research instructions exceed the model context budget.')
  let perSource = Math.floor((limit - overhead) / Math.max(1, options.contents.length))
  let prompt = ''
  do {
    prompt = options.render(
      options.contents.map((content) => selectSourcePassages(content, options.query, perSource)),
    )
    if (countTokens(prompt) <= limit) return prompt
    perSource = Math.floor(perSource * 0.8)
  } while (perSource > 0)
  return options.render(options.contents.map(() => ''))
}
