<script setup lang="ts">
  const { locale: globalLocale, availableLocales, t, setLocale } = useI18n()

  const props = defineProps<{
    /** Override display locale */
    value?: Locale
    /** If true, it will not change global locales */
    private?: boolean
  }>()

  const emit = defineEmits<{
    (e: 'update', value: Locale): void
  }>()

  const localeOptions = availableLocales.map((locale) => ({
    value: locale,
    label: t('language', {}, { locale }),
  }))

  function changeLocale(l: Locale) {
    emit('update', l)
    if (props.private) return
    setLocale(l)
  }
</script>

<template>
  <USelect
    icon="i-lucide-languages"
    :model-value="value ?? globalLocale"
    :items="localeOptions"
    :aria-label="t('common.language')"
    :title="t('common.language')"
    @update:model-value="changeLocale($event)"
  />
</template>
