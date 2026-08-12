<script setup lang="ts">
  const show = ref(false)
  const password = defineModel<string>()
  const { t } = useI18n()
  const inputId = useId()
</script>

<template>
  <UInput
    :id="inputId"
    v-model="password"
    :type="show ? 'text' : 'password'"
    :ui="{ trailing: 'pe-1' }"
  >
    <template #trailing>
      <UButton
        color="neutral"
        variant="link"
        size="sm"
        :icon="show ? 'i-lucide-eye-off' : 'i-lucide-eye'"
        :aria-label="show ? t('common.hidePassword') : t('common.showPassword')"
        :aria-pressed="show"
        :aria-controls="inputId"
        type="button"
        @click="show = !show"
      />
    </template>
  </UInput>
</template>
