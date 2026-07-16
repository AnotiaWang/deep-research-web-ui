<script setup lang="ts">
  import { usePreferredColorScheme } from '@vueuse/core'

  const colorMode = useColorMode()
  const { t } = useI18n()
  const preferredColor = usePreferredColorScheme()
  const preference = computed(() => {
    // 默认为自动，会跟随用户的浏览器切换
    if (colorMode.preference === 'system') {
      if (preferredColor.value === 'no-preference') return 'dark'
      return preferredColor.value
    }
    return colorMode.preference
  })

  const toggleColorMode = () => {
    colorMode.preference = preference.value === 'light' ? 'dark' : 'light'
  }

  const toggleLabel = computed(() =>
    preference.value === 'dark' ? t('common.useLightTheme') : t('common.useDarkTheme'),
  )
</script>

<template>
  <div>
    <UButton
      :icon="preference === 'dark' ? 'i-lucide-sun' : 'i-lucide-moon'"
      color="primary"
      :aria-label="toggleLabel"
      :title="toggleLabel"
      @click="toggleColorMode"
    />
  </div>
</template>
