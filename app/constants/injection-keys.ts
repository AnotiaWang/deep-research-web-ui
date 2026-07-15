import type { ResearchResult } from '~~/lib/core/deep-research'
import type { ResearchFeedbackResult, ResearchInputData } from '~~/shared/types/research-session'

export const formInjectionKey = Symbol() as InjectionKey<Ref<ResearchInputData>>
export const feedbackInjectionKey = Symbol() as InjectionKey<Ref<ResearchFeedbackResult[]>>
export const researchResultInjectionKey = Symbol() as InjectionKey<Ref<ResearchResult>>
