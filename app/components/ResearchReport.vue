<script setup lang="ts">
  import type { DeepReadonly } from 'vue'
  import { useServerMode } from '~/composables/useServerMode'
  import { createCitationHtml, renderSafeMarkdown } from '~/utils/markdown'
  import { buildReportDocument, publishReportPage, type PublishedReport } from '~/utils/deed-page'
  import { getStreamErrorMessage } from '~~/shared/utils/stream-error'
  import type ResearchEvidence from './ResearchEvidence.vue'
  import type { RefinementRequest, RefinementStage } from '~/utils/research-refinement'
  import type {
    ResearchFeedbackSnapshot,
    ResearchInputSnapshot,
    ResearchResult,
  } from '~~/shared/types/research-session'

  export interface GenerateReportOptions {
    input: ResearchInputSnapshot
    feedback: ReadonlyArray<ResearchFeedbackSnapshot>
    result: ResearchResult
    isCurrent: () => boolean
    signal?: AbortSignal
  }

  const props = defineProps<{
    disabled?: boolean
    query: string
    result: DeepReadonly<ResearchResult>
    refineDisabled?: boolean
    refining?: boolean
    refinementStage?: RefinementStage
    refinementError?: string
    refinementSuccess?: string
  }>()

  const emit = defineEmits<{
    (e: 'complete', report: string): void
    (e: 'regenerate'): void
    (e: 'refine', request: RefinementRequest): void
    (e: 'cancel-refinement'): void
  }>()

  const { t, locale } = useI18n()
  const { config } = storeToRefs(useConfigStore())
  const toast = useToast()
  const { writeFinalReport: reportFunction } = useServerMode()

  const error = ref('')
  const loading = ref(false)
  const loadingExportPdf = ref(false)
  const loadingExportMarkdown = ref(false)
  const publishOpen = shallowRef(false)
  const publishing = shallowRef(false)
  const publishError = shallowRef('')
  const publishExpiry = shallowRef('604800')
  const publishedPage = shallowRef<PublishedReport>()
  const publishExpiryItems = computed(() => [
    { label: t('researchReport.publishExpiryDay'), value: '86400' },
    { label: t('researchReport.publishExpiryWeek'), value: '604800' },
    { label: t('researchReport.publishExpiryMonth'), value: '2592000' },
    { label: t('researchReport.publishExpiryNever'), value: '0' },
  ])
  const reasoningContent = ref('')
  const reportContent = ref('')
  const reportContainerRef = ref<HTMLElement>()
  const evidencePanel = useTemplateRef<InstanceType<typeof ResearchEvidence>>('evidencePanel')
  const evidenceVisible = shallowRef(false)
  const selectedLearningIndex = shallowRef(0)
  const citedIndices = computed(() =>
    [
      ...new Set(
        [...reportContent.value.matchAll(/\[(\d+)\](?!\()/g)].map((match) => Number(match[1]) - 1),
      ),
    ].filter((index) => index >= 0 && index < props.result.learnings.length),
  )
  watch(citedIndices, (indices) => {
    if (!indices.includes(selectedLearningIndex.value)) {
      selectedLearningIndex.value = indices[0] ?? 0
    }
  })

  async function showEvidence(index = citedIndices.value[0]) {
    if (index === undefined || !props.result.learnings[index] || props.refining) return
    selectedLearningIndex.value = index
    evidenceVisible.value = true
    await nextTick()
    evidencePanel.value?.focus()
  }

  function handleReportClick(event: MouseEvent) {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
    const anchor = (event.target as HTMLElement).closest('.citation-ref a')
    if (!anchor) return
    const number = Number(anchor.textContent?.match(/\[(\d+)\]/)?.[1])
    if (number > 0 && props.result.learnings[number - 1]) {
      event.preventDefault()
      removeTooltip()
      showEvidence(number - 1)
    }
  }

  const isExportButtonDisabled = computed(
    () =>
      !reportContent.value ||
      loading.value ||
      loadingExportPdf.value ||
      loadingExportMarkdown.value ||
      publishing.value,
  )

  const reportHtml = computed(() => {
    const learnings = props.result.learnings
    const markdownWithCitations = reportContent.value.replace(
      /\[(\d+)\](?!\()/g,
      (match, number) => {
        const index = parseInt(number) - 1
        const learning = index >= 0 && index < learnings.length ? learnings[index] : ''
        if (!learning) return match
        return createCitationHtml(match, learning.url, learning.title || learning.url)
      },
    )

    return renderSafeMarkdown(markdownWithCitations)
  })

  // 在 DOM 更新后设置 tooltip 事件监听
  onMounted(() => {
    nextTick(() => {
      setupTooltips()
    })
  })

  // A published page is a snapshot; a new or regenerated report needs a new publish.
  watch(reportContent, () => {
    publishedPage.value = undefined
  })

  // 监听报告内容变化，重新设置 tooltip
  watch(reportContent, () => {
    nextTick(() => {
      setupTooltips()
    })
  })

  let tooltipElement: HTMLElement | undefined

  function removeTooltip() {
    tooltipElement?.remove()
    tooltipElement = undefined
  }

  onUnmounted(removeTooltip)

  // 设置 tooltip 事件监听
  function setupTooltips() {
    removeTooltip()
    if (!reportContainerRef.value) return

    // 创建一个通用的 tooltip 元素
    const tooltip = document.createElement('div')
    tooltipElement = tooltip
    tooltip.className =
      'citation-tooltip fixed px-2 py-1 bg-gray-800 text-white text-xs rounded z-50 opacity-0 transition-opacity duration-200 max-w-[calc(100vw-2rem)] overflow-hidden text-ellipsis pointer-events-none'
    document.body.appendChild(tooltip)

    // 为所有引用添加鼠标事件
    const refs = reportContainerRef.value.querySelectorAll('.citation-ref a')
    refs.forEach((ref) => {
      ref.addEventListener('mouseenter', (e) => {
        const target = e.currentTarget as HTMLElement
        const content = target.title

        // 设置 tooltip 内容
        tooltip.textContent = content
        tooltip.style.opacity = '1'

        // 计算位置
        const rect = target.getBoundingClientRect()
        const tooltipRect = tooltip.getBoundingClientRect()

        // 默认显示在引用上方
        let top = rect.top - tooltipRect.height - 8
        let left = rect.left + rect.width / 2

        // 如果 tooltip 会超出顶部，则显示在下方
        if (top < 10) {
          top = rect.bottom + 8
        }

        // 确保 tooltip 不会超出左右边界
        const maxLeft = window.innerWidth - tooltipRect.width - 10
        const minLeft = 10
        left = Math.min(Math.max(left, minLeft), maxLeft)

        tooltip.style.top = `${top}px`
        tooltip.style.left = `${left}px`
      })

      ref.addEventListener('mouseleave', () => {
        tooltip.style.opacity = '0'
      })
    })
  }

  let printJS: typeof import('print-js') | undefined

  let activeReport = 0

  async function generateReport(options: GenerateReportOptions) {
    const reportId = ++activeReport
    const { input, feedback: feedbackSnapshot, result, signal } = options
    const isCurrent = options.isCurrent
    const previousReport = reportContent.value
    loading.value = true
    error.value = ''
    reportContent.value = ''
    reasoningContent.value = ''
    try {
      // Store a copy of the data
      const learnings = [...result.learnings]
      console.log(`[generateReport] Generating report. Learnings:`, learnings)
      const { fullStream } = await reportFunction({
        prompt: getCombinedQuery(input, [...feedbackSnapshot]),
        language: t('language', {}, { locale: locale.value }),
        learnings,
        aiConfig: config.value.ai,
        signal,
      })
      for await (const chunk of fullStream) {
        if (!isCurrent()) return
        if (chunk.type === 'reasoning') {
          reasoningContent.value += chunk.textDelta
        } else if (chunk.type === 'text-delta') {
          reportContent.value += chunk.textDelta
        } else if (chunk.type === 'error') {
          throw new Error(getStreamErrorMessage(chunk as { error?: unknown; message?: unknown }))
        }
      }
      if (!isCurrent()) return

      reportContent.value += `\n\n## ${t('researchReport.sources')}\n\n${learnings
        .map((item, index) => `${index + 1}. [${item.title || item.url}](${item.url})`)
        .join('\n')}`

      // 触发完成事件
      emit('complete', reportContent.value)
      return reportContent.value
    } catch (e: any) {
      if (!isCurrent()) return
      console.error(`Generate report failed`, e)
      reportContent.value = previousReport
      error.value = t('researchReport.generateFailed', [e.message])
      throw e
    } finally {
      if (reportId === activeReport) {
        if (!isCurrent()) {
          reportContent.value = previousReport
          reasoningContent.value = ''
        }
        loading.value = false
      }
    }
  }

  async function exportToPdf() {
    loadingExportPdf.value = true
    const temporaryTitle = useHead({
      title: `Deep Research Report - ${props.query || 'Untitled'}`,
    })
    let printDialogOpened = false
    let cleanedUp = false
    const cleanup = () => {
      if (cleanedUp) return
      cleanedUp = true
      temporaryTitle.dispose()
      loadingExportPdf.value = false
    }
    try {
      await new Promise((resolve) => setTimeout(resolve, 100))

      if (!printJS) {
        printJS = (await import('print-js')).default
      }

      printJS({
        printable: reportHtml.value,
        type: 'raw-html',
        showModal: true,
        onIncompatibleBrowser() {
          toast.add({
            title: t('researchReport.incompatibleBrowser'),
            description: t('researchReport.incompatibleBrowserDescription'),
            duration: 10_000,
          })
          cleanup()
        },
        onError(error, xmlHttpRequest) {
          console.error(`[Export PDF] failed:`, error, xmlHttpRequest)
          toast.add({
            title: t('researchReport.exportFailed'),
            description: error instanceof Error ? error.message : String(error),
            duration: 10_000,
          })
          cleanup()
        },
        onPrintDialogClose() {
          cleanup()
        },
      })
      printDialogOpened = true
    } catch (error) {
      console.error(`[Export PDF] failed:`, error)
      toast.add({
        title: t('researchReport.exportFailed'),
        description: error instanceof Error ? error.message : String(error),
        duration: 10_000,
      })
    } finally {
      if (!printDialogOpened) cleanup()
    }
  }

  async function exportToMarkdown() {
    if (!reportContent.value) return

    loadingExportMarkdown.value = true
    try {
      // 使用原始的 Markdown 内容，它已经包含了 [1], [2] 等引用角标
      const blob = new Blob([reportContent.value], { type: 'text/markdown' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `research-report-${new Date().toISOString().split('T')[0]}.md`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Export to Markdown failed:', error)
    } finally {
      loadingExportMarkdown.value = false
    }
  }

  function openPublishDialog() {
    publishError.value = ''
    publishOpen.value = true
  }

  async function publishToWeb() {
    if (!reportContent.value || publishing.value) return
    publishing.value = true
    publishError.value = ''
    try {
      const html = buildReportDocument(props.query, reportHtml.value, locale.value)
      publishedPage.value = await publishReportPage(html, {
        ttlSeconds: Number(publishExpiry.value),
      })
    } catch (error) {
      console.error('[Publish to web] failed:', error)
      publishError.value = error instanceof Error ? error.message : String(error)
    } finally {
      publishing.value = false
    }
  }

  function displayReport(report: string, keepEvidence = false) {
    activeReport += 1
    // 直接显示已有的报告内容
    reportContent.value = report
    reasoningContent.value = '' // 清空推理内容，因为不是新生成的
    loading.value = false
    error.value = ''
    if (!keepEvidence) evidenceVisible.value = false
  }

  defineExpose({
    generateReport,
    exportToPdf,
    exportToMarkdown,
    displayReport,
  })
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center justify-between gap-2">
        <h2 class="font-bold">{{ $t('researchReport.title') }}</h2>
        <UButton
          icon="i-lucide-refresh-cw"
          :loading
          :disabled="props.disabled"
          variant="ghost"
          @click="emit('regenerate')"
        >
          {{ $t('researchReport.regenerate') }}
        </UButton>
      </div>
    </template>

    <UAlert v-if="error" :title="error" color="error" variant="soft" />

    <div class="flex flex-wrap gap-1 mb-4 justify-end">
      <UButton
        v-if="citedIndices.length"
        variant="ghost"
        icon="i-lucide-book-open-check"
        size="sm"
        :disabled="loading || refining"
        @click="showEvidence()"
        >{{ $t('researchEvidence.open') }}</UButton
      >
      <UButton
        color="info"
        variant="ghost"
        icon="i-lucide-download"
        size="sm"
        :disabled="isExportButtonDisabled"
        :loading="loadingExportMarkdown"
        @click="exportToMarkdown"
      >
        {{ $t('researchReport.exportMarkdown') }}
      </UButton>
      <UButton
        color="info"
        variant="ghost"
        icon="i-lucide-download"
        size="sm"
        :disabled="isExportButtonDisabled"
        :loading="loadingExportPdf"
        @click="exportToPdf"
      >
        {{ $t('researchReport.exportPdf') }}
      </UButton>
      <UButton
        color="info"
        variant="ghost"
        icon="i-lucide-globe"
        size="sm"
        :disabled="isExportButtonDisabled"
        :loading="publishing"
        @click="openPublishDialog"
      >
        {{ $t('researchReport.publish') }}
      </UButton>
    </div>

    <UModal
      v-model:open="publishOpen"
      :title="$t('researchReport.publishTitle')"
      :description="$t('researchReport.publishDescription')"
    >
      <template #body>
        <div class="flex flex-col gap-y-3">
          <UAlert
            color="warning"
            variant="soft"
            icon="i-lucide-triangle-alert"
            :title="$t('researchReport.publishWarning')"
          />
          <template v-if="publishedPage">
            <UFormField :label="$t('researchReport.publishedUrl')">
              <ULink :to="publishedPage.url" target="_blank" rel="noopener noreferrer" external>
                {{ publishedPage.url }}
              </ULink>
            </UFormField>
            <UFormField
              v-if="publishedPage.token"
              :label="$t('researchReport.publishedToken')"
              :help="$t('researchReport.publishedTokenHelp')"
            >
              <UInput :model-value="publishedPage.token" readonly class="w-full" />
            </UFormField>
          </template>
          <template v-else>
            <UFormField :label="$t('researchReport.publishExpiry')">
              <USelect v-model="publishExpiry" :items="publishExpiryItems" class="w-full" />
            </UFormField>
            <UAlert v-if="publishError" color="error" variant="soft" :title="publishError" />
            <div class="flex justify-end gap-2">
              <UButton variant="ghost" @click="publishOpen = false">
                {{ $t('researchReport.publishCancel') }}
              </UButton>
              <UButton icon="i-lucide-globe" :loading="publishing" @click="publishToWeb">
                {{ $t('researchReport.publishConfirm') }}
              </UButton>
            </div>
          </template>
        </div>
      </template>
    </UModal>

    <ResearchEvidence
      v-if="evidenceVisible"
      ref="evidencePanel"
      v-model="selectedLearningIndex"
      :learnings="result.learnings"
      :cited-indices="citedIndices"
      :disabled="refineDisabled || loading"
      :pending="refining"
      :stage="refinementStage"
      :error="refinementError"
      :success="refinementSuccess"
      @refine="emit('refine', $event)"
      @cancel="emit('cancel-refinement')"
      @close="evidenceVisible = false"
    />

    <ReasoningAccordion
      v-if="reasoningContent"
      v-model="reasoningContent"
      class="mb-4"
      :loading="loading"
    />

    <div
      ref="reportContainerRef"
      v-if="reportContent"
      class="prose prose-sm max-w-none break-words p-6 bg-gray-50 dark:bg-gray-800 dark:prose-invert dark:text-white rounded-lg shadow"
      @click="handleReportClick"
      v-html="reportHtml"
    />
    <div v-else>
      {{ loading ? $t('researchReport.generating') : $t('researchReport.waiting') }}
    </div>
  </UCard>
</template>

<style scoped>
  :deep(.citation-ref) {
    display: inline-block;
    vertical-align: super;
    font-size: 0.75rem;
    font-weight: 500;
    color: #3b82f6;
  }

  :deep(.citation-ref a) {
    color: inherit;
    text-decoration: none;
  }
</style>
