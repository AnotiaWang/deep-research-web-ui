<script setup lang="ts">
  import { formInjectionKey } from '~/constants/injection-keys'

  defineProps<{
    isLoadingFeedback: boolean
    disabled?: boolean
    submitDisabled?: boolean
  }>()

  const emit = defineEmits<{
    (e: 'submit'): void
  }>()

  const form = inject(formInjectionKey)!

  const isSubmitButtonDisabled = computed(
    () => !form.value.query || !form.value.breadth || !form.value.depth || !form.value.numQuestions,
  )

  function handleSubmit() {
    emit('submit')
  }
</script>

<template>
  <UCard>
    <template #header>
      <h2 class="font-bold">{{ $t('researchTopic.title') }}</h2>
    </template>
    <div class="flex flex-col gap-2">
      <UFormField :label="$t('researchTopic.inputTitle')" required>
        <UTextarea
          class="w-full"
          v-model="form.query"
          :rows="3"
          :placeholder="$t('researchTopic.placeholder')"
          :disabled="disabled"
          required
        />
      </UFormField>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <UFormField :label="$t('researchTopic.numOfQuestions')" required>
          <template #help>
            {{ $t('researchTopic.numOfQuestionsHelp') }}
          </template>
          <UInput
            v-model="form.numQuestions"
            class="w-full"
            type="number"
            :min="1"
            :max="5"
            :step="1"
            :disabled="disabled"
          />
        </UFormField>

        <UFormField :label="$t('researchTopic.depth')" required>
          <template #help>{{ $t('researchTopic.depthHelp') }}</template>
          <UInput
            v-model="form.depth"
            class="w-full"
            type="number"
            :min="1"
            :max="8"
            :step="1"
            :disabled="disabled"
          />
        </UFormField>

        <UFormField :label="$t('researchTopic.breadth')" required>
          <template #help>{{ $t('researchTopic.breadthHelp') }}</template>
          <UInput
            v-model="form.breadth"
            class="w-full"
            type="number"
            :min="1"
            :max="8"
            :step="1"
            :disabled="disabled"
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
        @click="handleSubmit"
      >
        {{ isLoadingFeedback ? $t('researchTopic.researching') : $t('researchTopic.start') }}
      </UButton>
    </template>
  </UCard>
</template>
