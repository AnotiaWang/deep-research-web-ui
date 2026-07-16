<template>
  <UApp :locale="uiLocale">
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>

<script setup lang="ts">
  import { en, nl, zh_cn } from '@nuxt/ui/locale'

  const { locale } = useI18n()
  const uiLocales = { en, nl, zh: zh_cn } as const
  const uiLocale = computed(() => uiLocales[locale.value as keyof typeof uiLocales] ?? en)

  // TODO
  useHead({
    title: 'Deep Research Web UI',
    script: [
      // Anonymous analytics
      {
        defer: true,
        src: 'https://umami.ataw.top/script.js',
        'data-website-id': '8479d775-7ce4-4300-a8bb-6d83b2579e41',
        'data-tag': useRuntimeConfig().public.version,
      },
    ],
  })
</script>
