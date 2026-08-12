<script setup lang="ts">
  import type {
    ResearchFailure,
    ResearchPhase,
    ResearchSessionStatus,
  } from '~~/shared/types/research-session'

  const props = defineProps<{
    status: ResearchSessionStatus
    phase?: ResearchPhase
    failure?: ResearchFailure
  }>()

  const emit = defineEmits<{
    (e: 'cancel'): void
  }>()

  const { t } = useI18n()

  const color = computed(() => {
    if (props.status === 'completed') return 'success' as const
    if (['failed', 'cancelled', 'timed-out'].includes(props.status)) return 'error' as const
    return 'info' as const
  })

  const title = computed(() => {
    const status = t(`researchSession.status.${props.status}`)
    return props.phase ? `${status}: ${t(`researchSession.phase.${props.phase}`)}` : status
  })

  const actions = computed(() =>
    props.status === 'running'
      ? [
          {
            label: t('common.cancel'),
            color: 'warning' as const,
            icon: 'i-lucide-square',
            onClick: () => emit('cancel'),
          },
        ]
      : [],
  )
</script>

<template>
  <UAlert
    v-if="status !== 'idle'"
    :title="title"
    :description="failure?.message"
    :actions="actions"
    :color="color"
    variant="soft"
  />
</template>
