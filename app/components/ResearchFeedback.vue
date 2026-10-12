<script setup lang="ts">
  import { useServerMode } from '~/composables/useServerMode'
  import { hasMeaningfulFeedbackQuestions, mergeFeedbackQuestions } from '~/utils/feedback'
  import type {
    ResearchFeedbackResult,
    ResearchInputSnapshot,
  } from '~~/shared/types/research-session'
  import {
    findResearchPreset,
    isResearchPreset,
    researchPresets,
    type ResearchDepthSettings,
    type ResearchPreset,
  } from '~~/shared/utils/research-input'

  export interface GetFeedbackOptions {
    input: ResearchInputSnapshot
    isCurrent: () => boolean
    signal?: AbortSignal
  }

  const props = defineProps<{
    isLoadingSearch?: boolean
    disabled?: boolean
    /** Ask the model to recommend a research preset along with its questions */
    autoMode?: boolean
  }>()

  const emit = defineEmits<{
    (e: 'submit', settings?: ResearchDepthSettings): void
  }>()

  const feedback = defineModel<ResearchFeedbackResult[]>({ required: true })

  const { t, locale } = useI18n()
  const { showConfigManager, isConfigValid, config } = storeToRefs(useConfigStore())
  const runtimeConfig = useRuntimeConfig()
  const isServerMode = computed(() => runtimeConfig.public.serverMode)
  const toast = useToast()
  const { generateFeedback: feedbackFunction } = useServerMode()

  const reasoningContent = ref('')
  const isLoading = ref(false)
  const error = ref('')
  /** True after a feedback request finished successfully (including zero questions). */
  const feedbackReady = ref(false)

  const presetItems = useResearchPresetItems()
  /** Set when the request asked for a recommendation; the user confirms it before research. */
  const modeSelectable = ref(false)
  const suggestedMode = ref<ResearchPreset>()
  const suggestedModeReason = ref('')
  const selectedMode = ref<ResearchPreset>()
  const selectedModeItem = computed(() =>
    presetItems.value.find((item) => item.value === selectedMode.value),
  )

  function submit() {
    emit(
      'submit',
      modeSelectable.value && selectedMode.value
        ? { ...researchPresets[selectedMode.value] }
        : undefined,
    )
  }

  const isSubmitButtonDisabled = computed(() => {
    if (isLoading.value || props.isLoadingSearch || props.disabled || !feedbackReady.value) {
      return true
    }
    if (!Array.isArray(feedback.value)) return true
    // Empty list means the model judged the query clear enough to proceed.
    if (!feedback.value.length) return false
    return feedback.value.some((v) => !v.assistantQuestion || !v.userAnswer)
  })

  let activeRequest = 0

  async function getFeedback(options: GetFeedbackOptions) {
    const requestId = ++activeRequest
    const { input, signal } = options
    const isCurrent = options.isCurrent
    clear()
    activeRequest = requestId

    if (!isConfigValid.value && !isServerMode.value) {
      toast.add({
        title: t('index.missingConfigTitle'),
        description: t('index.missingConfigDescription'),
        color: 'error',
      })
      showConfigManager.value = true
      throw new Error(t('index.missingConfigDescription'))
    }
    isLoading.value = true
    const suggestResearchMode = !!props.autoMode
    let researchMode: unknown
    let researchModeReason: unknown
    try {
      const chunks = await feedbackFunction({
        query: input.query,
        numQuestions: input.numQuestions,
        suggestResearchMode,
        language: t('language', {}, { locale: locale.value }),
        aiConfig: config.value.ai,
        signal,
      })

      for await (const chunk of chunks) {
        if (!isCurrent()) return
        if (chunk.type === 'reasoning') {
          reasoningContent.value += chunk.delta
        } else if (chunk.type === 'error') {
          error.value = chunk.message
        } else if (chunk.type === 'object') {
          feedback.value = mergeFeedbackQuestions(
            Array.isArray(feedback.value) ? feedback.value : [],
            chunk.value?.questions,
          )
          researchMode = chunk.value?.researchMode
          researchModeReason = chunk.value?.researchModeReason
        } else if (chunk.type === 'bad-end') {
          error.value = t(
            chunk.finishReason === 'length'
              ? 'truncatedStructuredOutput'
              : 'invalidStructuredOutput',
          )
        }
      }
      if (!isCurrent()) return
      console.log(`[ResearchFeedback] query: ${input.query}, feedback:`, feedback.value)
      if (error.value) {
        feedback.value = []
        throw new Error(error.value)
      }
      // Placeholder-only streams are treated as invalid; a true empty list is OK
      // only when the model explicitly returned {"questions":[]} (no bad-end).
      if (!hasMeaningfulFeedbackQuestions(feedback.value)) {
        feedback.value = []
      }
      if (suggestResearchMode) {
        // Partial JSON may stop mid-value, so only an exact preset key counts as a suggestion.
        suggestedMode.value = isResearchPreset(researchMode) ? researchMode : undefined
        suggestedModeReason.value =
          suggestedMode.value && typeof researchModeReason === 'string'
            ? researchModeReason.trim()
            : ''
        selectedMode.value = suggestedMode.value ?? findResearchPreset(input) ?? 'standard'
        modeSelectable.value = true
      }
      feedbackReady.value = true
      return (Array.isArray(feedback.value) ? feedback.value : []).map((item) => ({ ...item }))
    } catch (e: any) {
      if (!isCurrent()) return
      console.error('Error getting feedback:', e)
      if (e.message?.includes('Failed to fetch')) {
        e.message += `\n${t('error.requestBlockedByCORS')}`
      }
      feedback.value = []
      feedbackReady.value = false
      error.value = t('modelFeedback.error', [e.message])
      throw e
    } finally {
      if (requestId === activeRequest) isLoading.value = false
    }
  }

  function clear() {
    activeRequest += 1
    feedback.value = []
    error.value = ''
    reasoningContent.value = ''
    isLoading.value = false
    feedbackReady.value = false
    modeSelectable.value = false
    suggestedMode.value = undefined
    suggestedModeReason.value = ''
    selectedMode.value = undefined
  }

  defineExpose({
    getFeedback,
    clear,
    isLoading,
  })
</script>

<template>
  <UCard>
    <template #header>
      <h2 class="font-bold">{{ $t('modelFeedback.title') }}</h2>
      <p class="text-sm text-gray-500">
        {{ $t('modelFeedback.description') }}
      </p>
    </template>

    <div class="flex flex-col gap-2">
      <div v-if="!feedbackReady && !feedback.length && !reasoningContent && !error">
        {{ $t('modelFeedback.waiting') }}
      </div>
      <template v-else>
        <div v-if="error" class="text-red-500 whitespace-pre-wrap">
          {{ error }}
        </div>
        <div
          v-else-if="feedbackReady && !feedback.length"
          class="text-sm text-gray-500 whitespace-pre-wrap"
        >
          {{ $t('modelFeedback.noQuestions') }}
        </div>

        <ReasoningAccordion v-model="reasoningContent" :loading="isLoading" />

        <div
          v-for="(item, index) in feedback"
          v-show="item.assistantQuestion"
          class="flex flex-col gap-2"
          :key="index"
        >
          <label :for="`feedback-answer-${index}`">
            {{ item.assistantQuestion }}
          </label>
          <UInput :id="`feedback-answer-${index}`" v-model="item.userAnswer" :disabled="disabled" />
        </div>

        <UFormField
          v-if="feedbackReady && modeSelectable"
          :label="$t('modelFeedback.researchMode')"
        >
          <URadioGroup
            v-model="selectedMode"
            :items="presetItems"
            orientation="horizontal"
            :disabled="disabled"
            :ui="{ description: 'hidden' }"
          />
          <template #help>
            <p v-if="suggestedMode">
              {{
                $t('modelFeedback.suggestedMode', {
                  mode: $t(`researchTopic.presets.${suggestedMode}.label`),
                })
              }}{{ suggestedModeReason }}
            </p>
            <p v-else>{{ $t('modelFeedback.noSuggestedMode') }}</p>
            <p v-if="selectedModeItem">
              {{ $t('modelFeedback.modeEstimate', { count: selectedModeItem.count }) }}
            </p>
          </template>
        </UFormField>
      </template>
      <UButton
        color="primary"
        :loading="isLoadingSearch || isLoading"
        :disabled="isSubmitButtonDisabled"
        block
        @click="submit"
      >
        {{
          feedbackReady && !feedback.length
            ? $t('modelFeedback.continue')
            : $t('modelFeedback.submit')
        }}
      </UButton>
    </div>
  </UCard>
</template>
