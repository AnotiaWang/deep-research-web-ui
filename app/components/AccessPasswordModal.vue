<script setup lang="ts">
  const { password, promptOpen, checkAccess } = useAccessPassword()
  const { t } = useI18n()
  const toast = useToast()

  const candidate = ref('')
  const checking = ref(false)
  const error = ref('')

  async function submit() {
    if (!candidate.value || checking.value) return
    checking.value = true
    error.value = ''
    try {
      const status = await checkAccess(candidate.value)
      if (!status.authorized) {
        error.value = t('accessPassword.invalid')
        return
      }
      password.value = candidate.value
      promptOpen.value = false
      toast.add({ title: t('accessPassword.success'), color: 'success' })
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      checking.value = false
    }
  }

  watch(promptOpen, (open) => {
    if (!open) return
    candidate.value = password.value
    error.value = ''
  })

  onMounted(async () => {
    try {
      const status = await checkAccess()
      if (!status.authorized) promptOpen.value = true
    } catch (e) {
      // Requests will surface the failure; the prompt reopens on HTTP 401.
      console.error('Failed to check access password status', e)
    }
  })
</script>

<template>
  <UModal
    v-model:open="promptOpen"
    :title="$t('accessPassword.title')"
    :description="$t('accessPassword.description')"
  >
    <template #body>
      <form class="flex flex-col gap-y-3" @submit.prevent="submit">
        <UFormField :label="$t('accessPassword.label')" :error="error || undefined">
          <PasswordInput
            v-model="candidate"
            class="w-full"
            autofocus
            :placeholder="$t('accessPassword.label')"
          />
        </UFormField>
        <div class="flex justify-end">
          <UButton
            type="submit"
            icon="i-lucide-lock-open"
            :loading="checking"
            :disabled="!candidate"
          >
            {{ $t('accessPassword.submit') }}
          </UButton>
        </div>
      </form>
    </template>
  </UModal>
</template>
