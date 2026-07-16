<script setup lang="ts">
  import type { ResearchInputData } from '~~/shared/types/research-session'
  import { researchInputLimits, researchInputSchema } from '~~/shared/utils/research-input'

  defineProps<{
    isLoadingFeedback: boolean
    disabled?: boolean
    submitDisabled?: boolean
  }>()

  const emit = defineEmits<{
    (e: 'submit', input: ResearchInputData): void
  }>()

  const { t } = useI18n()
  const form = defineModel<ResearchInputData>({ required: true })

  const validationResult = computed(() => researchInputSchema.safeParse(form.value))
  const isSubmitButtonDisabled = computed(() => !validationResult.value.success)

  function integerRangeError(
    value: unknown,
    field: keyof Pick<ResearchInputData, 'numQuestions' | 'depth' | 'breadth'>,
  ) {
    const number = Number(value)
    const { min, max } = researchInputLimits[field]
    if (Number.isInteger(number) && number >= min && number <= max) return
    return t('researchTopic.integerRange', { min, max })
  }

  const queryError = computed(() =>
    form.value.query.length > 0 && !form.value.query.trim()
      ? t('researchTopic.required')
      : undefined,
  )
  const numQuestionsError = computed(() =>
    integerRangeError(form.value.numQuestions, 'numQuestions'),
  )
  const depthError = computed(() => integerRangeError(form.value.depth, 'depth'))
  const breadthError = computed(() => integerRangeError(form.value.breadth, 'breadth'))

  function handleSubmit() {
    const result = researchInputSchema.safeParse(form.value)
    if (!result.success) return
    form.value = result.data
    emit('submit', result.data)
  }
</script>

<template>
  <form @submit.prevent="handleSubmit">
    <UCard>
      <template #header>
        <h2 class="font-bold">{{ $t('researchTopic.title') }}</h2>
      </template>
      <div class="flex flex-col gap-2">
        <UFormField :label="$t('researchTopic.inputTitle')" :error="queryError" required>
          <UTextarea
            v-model="form.query"
            class="w-full"
            name="query"
            :rows="3"
            :placeholder="$t('researchTopic.placeholder')"
            :disabled="disabled"
            required
          />
        </UFormField>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <UFormField
            :label="$t('researchTopic.numOfQuestions')"
            :error="numQuestionsError"
            required
          >
            <template #help>
              {{ $t('researchTopic.numOfQuestionsHelp') }}
            </template>
            <UInput
              v-model="form.numQuestions"
              class="w-full"
              name="numQuestions"
              type="number"
              :min="researchInputLimits.numQuestions.min"
              :max="researchInputLimits.numQuestions.max"
              :step="1"
              :disabled="disabled"
              required
            />
          </UFormField>

          <UFormField :label="$t('researchTopic.depth')" :error="depthError" required>
            <template #help>{{ $t('researchTopic.depthHelp') }}</template>
            <UInput
              v-model="form.depth"
              class="w-full"
              name="depth"
              type="number"
              :min="researchInputLimits.depth.min"
              :max="researchInputLimits.depth.max"
              :step="1"
              :disabled="disabled"
              required
            />
          </UFormField>

          <UFormField :label="$t('researchTopic.breadth')" :error="breadthError" required>
            <template #help>{{ $t('researchTopic.breadthHelp') }}</template>
            <UInput
              v-model="form.breadth"
              class="w-full"
              name="breadth"
              type="number"
              :min="researchInputLimits.breadth.min"
              :max="researchInputLimits.breadth.max"
              :step="1"
              :disabled="disabled"
              required
            />
          </UFormField>
        </div>
      </div>

      <template #footer>
        <UButton
          type="submit"
          color="primary"
          :loading="isLoadingFeedback"
          :disabled="disabled || submitDisabled || isSubmitButtonDisabled"
          block
        >
          {{ isLoadingFeedback ? $t('researchTopic.researching') : $t('researchTopic.start') }}
        </UButton>
      </template>
    </UCard>
  </form>
</template>
