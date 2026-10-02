import type { ConfigWebSearchProvider } from '~~/shared/types/config'
import { z } from 'zod'

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(value)
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  }, 'Invalid calendar date')

export const searchConstraintsSchema = z.object({
  intent: z.enum(['general', 'news']).optional(),
  timeRange: z.enum(['day', 'week', 'month', 'year']).optional(),
  startDate: dateSchema.optional(),
  endDate: dateSchema.optional(),
  includeDomains: z
    .array(z.string().regex(/^(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$/))
    .max(10)
    .optional(),
  sourcePreference: z.enum(['any', 'primary']).optional(),
})

export const searchPlanSchema = searchConstraintsSchema.extend({
  query: z.string().trim().min(1),
  researchGoal: z.string(),
})

export type SearchConstraints = z.infer<typeof searchConstraintsSchema>
export type SearchPlan = z.infer<typeof searchPlanSchema>
export type SearchLimitation = 'news' | 'time' | 'domains' | 'language'

/** Parent time windows and domain restrictions stay fixed during deeper searches and recovery. */
export function resolveSearchPlan(plan: SearchPlan, inherited?: SearchConstraints): SearchPlan {
  const hasInheritedTime = inherited?.timeRange || inherited?.startDate || inherited?.endDate
  const result = {
    ...plan,
    ...(inherited?.includeDomains?.length ? { includeDomains: [...inherited.includeDomains] } : {}),
    ...(hasInheritedTime
      ? {
          timeRange: inherited.timeRange,
          startDate: inherited.startDate,
          endDate: inherited.endDate,
        }
      : {}),
  }
  if (result.startDate || result.endDate) result.timeRange = undefined
  if (result.startDate && result.endDate && result.startDate > result.endDate) {
    throw new Error('Search start date must not be after end date')
  }
  return result
}

export const searchPlanningRules = `Plan a search task, not a bag of keywords.
- Each query covers ONE angle. Choose concise domain keywords, an exact identifier or phrase, or a natural-language question according to the task. Preserve error messages, standards, paper titles, model numbers, and technical terminology; never force these into a conversational sentence or truncate by word count.
- Avoid unrelated keyword piles and source-type alternatives such as "official blog OR paper". Academic terms and Boolean alternatives can be meaningful in professional searches; use only syntax explicitly supported by the current provider. Never send database-specific field syntax to a general web engine.
- Separate filters into intent (general/news), timeRange (day/week/month/year) OR startDate/endDate (YYYY-MM-DD), and includeDomains (bare domains, only when explicitly requested or already verified in prior sources). Omit unused fields. Never invent a domain or a publisher whitelist.
- For recent/latest news without an explicit period, use timeRange=week. Honor explicit dates using today's date; do not invent a month from model memory. Filters describe publication windows; verify event dates separately in source text.
- Broad AI news requires complementary discovery queries covering models, products, and industry; do not silently narrow it to LLM papers. Example: query="AI product launches", intent="news", timeRange="week", sourcePreference="any".
- First discover events broadly. Once an entity/event is known, follow up with its name to find primary evidence, using intent=general and sourcePreference=primary. Source preference is an extraction preference, not a keyword or a hard domain filter.
- Follow-ups and rewrites must keep the requested time window and inherited domain restrictions. A weak result is not permission to broaden dates or domains. Stay within the query budget.`

/** The same provider guidance is used for planning, extraction rewrites and quote repair. */
export function searchQueryGuidance(provider?: ConfigWebSearchProvider) {
  const common =
    'Prefer structured time and domain fields when available. Keep user-required exact identifiers and phrases when rewriting; simplify incidental wording, not the research constraints.'
  if (provider === 'firecrawl')
    return `${common} Current provider: Firecrawl. Supported query syntax: quoted exact phrases, -excluded terms, site:, filetype:, intitle:, inurl:. Use sparingly when the task benefits, e.g. intitle:"retrieval augmented generation" filetype:pdf. Boolean groups are not advertised by this adapter.`
  if (provider === 'parallel')
    return `${common} Current provider: Parallel. Supported query syntax: quoted exact phrases, -excluded terms, site:, filetype:, intitle:, inurl:. Use operators when they help the research goal.`
  if (provider === 'google-pse')
    return `${common} Current provider: Google PSE. Supported query syntax: quoted phrases, OR between closely related alternatives, -excluded terms, site:, filetype:. Avoid mixing independent research goals in one Boolean expression.`
  return `${common} Current provider: ${provider ?? 'unspecified'}. Use focused keywords, exact identifier text, or a concise natural-language query. Advanced operators are not confirmed for this adapter; express filters through supported structured fields. Do not assume Google or academic-database syntax works here.`
}
