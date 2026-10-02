<script setup lang="ts">
  import type { ResearchInputData } from '~~/shared/types/research-session'
  import {
    estimateMaxSearches,
    findResearchPreset,
    researchInputLimits,
    researchInputSchema,
    researchPresets,
  } from '~~/shared/utils/research-input'

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
  /** Let the model recommend breadth/depth during feedback; form values are the fallback. */
  const autoMode = defineModel<boolean>('autoMode', { default: false })

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

  const researchPresetItems = useResearchPresetItems()
  const presetItems = computed(() => [
    {
      value: 'auto' as const,
      label: t('researchTopic.presets.auto.label'),
      description: t('researchTopic.presets.auto.description'),
    },
    ...researchPresetItems.value,
  ])
  /** Derived from breadth/depth, so history items and manual edits stay in sync. */
  const preset = computed({
    get: () => (autoMode.value ? 'auto' : findResearchPreset(form.value)),
    set: (value) => {
      if (!value) return
      autoMode.value = value === 'auto'
      if (value !== 'auto') form.value = { ...form.value, ...researchPresets[value] }
    },
  })
  const estimatedSearches = computed(() =>
    autoMode.value || depthError.value || breadthError.value
      ? undefined
      : estimateMaxSearches(Number(form.value.breadth), Number(form.value.depth)),
  )

  const showAdvanced = ref(false)
  // Custom values or invalid fields must never be hidden behind the collapsed section.
  watch(
    () => !preset.value || !!(numQuestionsError.value || depthError.value || breadthError.value),
    (needsAdvanced) => {
      if (needsAdvanced) showAdvanced.value = true
    },
    { immediate: true },
  )

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

        <UFormField :label="$t('researchTopic.preset')">
          <template #help>{{ $t('researchTopic.presetHelp') }}</template>
          <URadioGroup
            v-model="preset"
            :items="presetItems"
            variant="card"
            orientation="horizontal"
            :disabled="disabled"
            :ui="{ fieldset: 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2', item: 'p-3' }"
          />
        </UFormField>

        <div>
          <UButton
            variant="link"
            color="neutral"
            class="px-0"
            :icon="showAdvanced ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
            @click="showAdvanced = !showAdvanced"
          >
            {{ $t('researchTopic.advanced') }}
          </UButton>
        </div>

        <div v-if="showAdvanced" class="flex flex-col gap-2">
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
                @update:model-value="autoMode = false"
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
                @update:model-value="autoMode = false"
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
          <p v-if="autoMode" class="text-sm text-gray-500">
            {{ $t('researchTopic.autoModeHint') }}
          </p>
          <p v-else-if="estimatedSearches" class="text-sm text-gray-500">
            {{ $t('researchTopic.estimatedSearches', { count: estimatedSearches }) }}
          </p>
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
