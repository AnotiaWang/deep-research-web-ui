<template>
  <UApp :locale="zh_cn">
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>

<script setup lang="ts">
  import { zh_cn } from '@nuxt/ui/locale'

  // TODO
  useHead({
    title: 'Deep Research Web UI',
    script: [
      // Anonymous analytics
      {
        defer: true,
        src: 'https://umami.ataw.top/script.js',
        'data-website-id': '9f925777-1c4c-440d-94ae-4bfee9e7aa71',
        'data-tag': useRuntimeConfig().public.version,
      },
    ],
  })
</script>
