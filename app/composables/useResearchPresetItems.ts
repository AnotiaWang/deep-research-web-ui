import {
  estimateMaxSearches,
  researchPresetKeys,
  researchPresets,
  type ResearchPreset,
} from '~~/shared/utils/research-input'

/** Localized radio items for the research presets. */
export function useResearchPresetItems() {
  const { t } = useI18n()

  return computed(() =>
    researchPresetKeys.map((value: ResearchPreset) => {
      const { breadth, depth } = researchPresets[value]
      const count = estimateMaxSearches(breadth, depth)
      return {
        value,
        label: t(`researchTopic.presets.${value}.label`),
        description: t(`researchTopic.presets.${value}.description`, { breadth, depth, count }),
        count,
      }
    }),
  )
}
