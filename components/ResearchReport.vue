<script setup lang="ts">
  import { marked } from 'marked'
  import { writeFinalReport } from '~/lib/deep-research'
  import {
    feedbackInjectionKey,
    formInjectionKey,
    researchResultInjectionKey,
  } from '~/constants/injection-keys'

  const { t, locale } = useI18n()
  const toast = useToast()

  const error = ref('')
  const loading = ref(false)
  const loadingExportPdf = ref(false)
  const loadingExportMarkdown = ref(false)
  const reasoningContent = ref('')
  const reportContent = ref('')

  // Inject global data from index.vue
  const form = inject(formInjectionKey)!
  const feedback = inject(feedbackInjectionKey)!
  const researchResult = inject(researchResultInjectionKey)!

  const reportHtml = computed(() =>
    marked(reportContent.value, { silent: true, gfm: true, breaks: true }),
  )
  const isExportButtonDisabled = computed(
    () =>
      !reportContent.value ||
      loading.value ||
      loadingExportPdf.value ||
      loadingExportMarkdown.value,
  )

  let printJS: typeof import('print-js') | undefined

  async function generateReport() {
    loading.value = true
    error.value = ''
    reportContent.value = ''
    reasoningContent.value = ''
    try {
      // Store a copy of the data
      const visitedUrls = researchResult.value.visitedUrls ?? []
      const learnings = researchResult.value.learnings ?? []
      const { fullStream } = writeFinalReport({
        prompt: getCombinedQuery(form.value, feedback.value),
        language: t('language', {}, { locale: locale.value }),
        learnings,
      })
      for await (const chunk of fullStream) {
        if (chunk.type === 'reasoning') {
          reasoningContent.value += chunk.textDelta
        } else if (chunk.type === 'text-delta') {
          reportContent.value += chunk.textDelta
        } else if (chunk.type === 'error') {
          error.value = t('researchReport.generateFailed', [
            chunk.error instanceof Error
              ? chunk.error.message
              : String(chunk.error),
          ])
        }
      }
      reportContent.value += `\n\n## ${t(
        'researchReport.sources',
      )}\n\n${visitedUrls.map((url) => `- ${url}`).join('\n')}`
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
      const blob = new Blob([reportContent.value], { type: 'text/markdown' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'research-report.md'
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

  defineExpose({
    generateReport,
    exportToPdf,
    exportToMarkdown,
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
          :disabled="!reasoningContent && !reportContent && !error"
          variant="ghost"
          @click="generateReport"
        >
          {{ $t('researchReport.regenerate') }}
        </UButton>
      </div>
    </template>

    <UAlert
      v-if="error"
      :title="$t('researchReport.exportFailed')"
      :description="error"
      color="error"
      variant="soft"
    />

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
      v-if="reportContent"
      class="prose prose-sm max-w-none break-words p-6 bg-gray-50 dark:bg-gray-800 dark:prose-invert dark:text-white rounded-lg shadow"
      v-html="reportHtml"
    />
    <div v-else>
      {{
        loading ? $t('researchReport.generating') : $t('researchReport.waiting')
      }}
    </div>
  </UCard>
</template>
