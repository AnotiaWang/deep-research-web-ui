<script setup lang="ts">
  import {
    feedbackInjectionKey,
    formInjectionKey,
    researchResultInjectionKey,
  } from '~/constants/injection-keys'
  import { useServerMode } from '~/composables/useServerMode'
  import { createCitationHtml, renderSafeMarkdown } from '~/utils/markdown'

  const { t, locale } = useI18n()
  const { config } = storeToRefs(useConfigStore())
  const toast = useToast()
  const { writeFinalReport: reportFunction } = useServerMode()

  const error = ref('')
  const loading = ref(false)
  const loadingExportPdf = ref(false)
  const loadingExportMarkdown = ref(false)
  const reasoningContent = ref('')
  const reportContent = ref('')
  const reportContainerRef = ref<HTMLElement>()

  // Inject global data from index.vue
  const form = inject(formInjectionKey)!
  const feedback = inject(feedbackInjectionKey)!
  const researchResult = inject(researchResultInjectionKey)!

  const isExportButtonDisabled = computed(
    () =>
      !reportContent.value ||
      loading.value ||
      loadingExportPdf.value ||
      loadingExportMarkdown.value,
  )

  const reportHtml = computed(() => {
    const learnings = researchResult.value?.learnings ?? []
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
    if (!reportContainerRef.value) return

    removeTooltip()

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

  async function generateReport() {
    loading.value = true
    error.value = ''
    reportContent.value = ''
    reasoningContent.value = ''
    try {
      // Store a copy of the data
      const learnings = [...researchResult.value.learnings]
      console.log(`[generateReport] Generating report. Learnings:`, learnings)
      const { fullStream } = await reportFunction({
        prompt: getCombinedQuery(form.value, feedback.value),
        language: t('language', {}, { locale: locale.value }),
        learnings,
        aiConfig: config.value.ai,
      })
      let streamFailed = false
      for await (const chunk of fullStream) {
        if (chunk.type === 'reasoning') {
          reasoningContent.value += chunk.textDelta
        } else if (chunk.type === 'text-delta') {
          reportContent.value += chunk.textDelta
        } else if (chunk.type === 'error') {
          error.value = t('researchReport.generateFailed', [
            chunk.error instanceof Error ? chunk.error.message : String(chunk.error),
          ])
          streamFailed = true
          break
        }
      }
      if (streamFailed) return

      reportContent.value += `\n\n## ${t('researchReport.sources')}\n\n${learnings
        .map((item, index) => `${index + 1}. [${item.title || item.url}](${item.url})`)
        .join('\n')}`

      // 触发完成事件
      emit('complete', reportContent.value)
    } catch (e: any) {
      console.error(`Generate report failed`, e)
      error.value = t('researchReport.generateFailed', [e.message])
    } finally {
      loading.value = false
    }
  }

  async function exportToPdf() {
    // Change the title back
    const cleanup = () => {
      useHead({
        title: 'Deep Research Web UI',
      })
      loadingExportPdf.value = false
    }
    loadingExportPdf.value = true
    // Temporarily change the document title, which will be used as the filename
    useHead({
      title: `Deep Research Report - ${form.value.query ?? 'Untitled'}`,
    })
    // Wait after title is changed
    await new Promise((r) => setTimeout(r, 100))

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
    return
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

  const emit = defineEmits<{
    (e: 'complete', report: string): void
  }>()

  function displayReport(report: string) {
    // 直接显示已有的报告内容
    reportContent.value = report
    reasoningContent.value = '' // 清空推理内容，因为不是新生成的
    loading.value = false
    error.value = ''
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
        <UButton icon="i-lucide-refresh-cw" :loading variant="ghost" @click="generateReport">
          {{ $t('researchReport.regenerate') }}
        </UButton>
      </div>
    </template>

    <UAlert v-if="error" :title="error" color="error" variant="soft" />

    <div class="flex mb-4 justify-end">
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
    </div>

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
