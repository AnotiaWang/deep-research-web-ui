<script setup lang="ts">
  import { useServerMode } from '~/composables/useServerMode'
  import { hasMeaningfulFeedbackQuestions, mergeFeedbackQuestions } from '~/utils/feedback'
  import type {
    ResearchFeedbackResult,
    ResearchInputSnapshot,
  } from '~~/shared/types/research-session'

  export interface GetFeedbackOptions {
    input: ResearchInputSnapshot
    isCurrent: () => boolean
    signal?: AbortSignal
  }

  const props = defineProps<{
    isLoadingSearch?: boolean
    disabled?: boolean
  }>()

  defineEmits<{
    (e: 'submit'): void
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

  const isSubmitButtonDisabled = computed(
    () =>
      !Array.isArray(feedback.value) ||
      !feedback.value.length ||
      // All questions should be answered
      feedback.value.some((v) => !v.assistantQuestion || !v.userAnswer) ||
      // Should not be loading
      isLoading.value ||
      props.isLoadingSearch ||
      props.disabled,
  )

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
    try {
      const chunks = await feedbackFunction({
        query: input.query,
        numQuestions: input.numQuestions,
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
        } else if (chunk.type === 'bad-end') {
          error.value = t('invalidStructuredOutput')
        }
      }
      if (!isCurrent()) return
      console.log(`[ResearchFeedback] query: ${input.query}, feedback:`, feedback.value)
      // Ignore streamed empty placeholders like ["", "", ""]
      if (!hasMeaningfulFeedbackQuestions(feedback.value)) {
        feedback.value = []
        error.value = t('modelFeedback.noQuestions')
      }
      if (error.value) {
        feedback.value = []
        throw new Error(error.value)
      }
      return (Array.isArray(feedback.value) ? feedback.value : []).map((item) => ({ ...item }))
    } catch (e: any) {
      if (!isCurrent()) return
      console.error('Error getting feedback:', e)
      if (e.message?.includes('Failed to fetch')) {
        e.message += `\n${t('error.requestBlockedByCORS')}`
      }
      feedback.value = []
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
      <div v-if="!feedback.length && !reasoningContent && !error">
        {{ $t('modelFeedback.waiting') }}
      </div>
      <template v-else>
        <div v-if="error" class="text-red-500 whitespace-pre-wrap">
          {{ error }}
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
      </template>
      <UButton
        color="primary"
        :loading="isLoadingSearch || isLoading"
        :disabled="isSubmitButtonDisabled"
        block
        @click="$emit('submit')"
      >
        {{ $t('modelFeedback.submit') }}
      </UButton>
    </div>
  </UCard>
</template>
