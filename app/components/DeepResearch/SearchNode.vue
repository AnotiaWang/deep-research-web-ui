<script setup lang="ts">
  import { Handle, Position } from '@vue-flow/core'
  import type { ButtonProps } from '@nuxt/ui'
  import type { SearchNodeData } from './SearchFlow.vue'

  const props = defineProps<{
    data: SearchNodeData
    selected?: boolean
  }>()

  const theme = computed(() => {
    const result = {
      icon: '',
      pulse: false,
      color: 'info' as ButtonProps['color'],
    }
    if (!props.data?.status) return result

    switch (props.data.status) {
      case 'generating_query':
      case 'generating_query_reasoning':
        result.icon = 'i-lucide-clipboard-list'
        result.pulse = true
        break
      case 'generated_query':
        result.icon = 'i-lucide-circle-pause'
        break
      case 'searching':
        result.icon = 'i-lucide-search'
        result.pulse = true
        break
      case 'search_complete':
        result.icon = 'i-lucide-search-check'
        break
      case 'processing_search_result':
      case 'processing_search_result_reasoning':
        result.icon = 'i-lucide-brain'
        result.pulse = true
        break
      case 'node_complete':
        result.icon = 'i-lucide-circle-check-big'
        break
      case 'error':
        result.icon = 'i-lucide-octagon-x'
        result.color = 'error'
        break
    }
    return result
  })
</script>

<template>
  <UButton
    class="process-node"
    :class="[theme.pulse && 'animate-pulse', 'max-w-90']"
    :color="selected ? 'primary' : theme.color"
    :variant="selected ? 'soft' : 'outline'"
    :icon="theme.icon"
    size="sm"
  >
    <Handle type="target" :position="Position.Left" />
    <Handle type="source" :position="Position.Right" />

    {{ data.title }}
  </UButton>
</template>

<style scoped>
  /* Hide the handles */
  .process-node .vue-flow__handle {
    border: none;
    height: unset;
    width: unset;
    background: transparent;
    font-size: 12px;
  }
</style>
