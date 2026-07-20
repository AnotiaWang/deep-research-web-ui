<template>
  <div>
    <UContainer>
      <div class="max-w-4xl mx-auto py-8 flex flex-col gap-y-4">
        <div class="flex flex-col sm:flex-row gap-2">
          <div class="flex flex-col sm:flex-row items-center mx-auto sm:ml-0 sm:mr-auto">
            <h1 class="text-3xl font-bold text-center mb-2 sm:mb-0 flex items-center">
              Deep Research
              <div class="inline-flex flex-col items-start ml-2">
                <span v-if="isServerMode" class="text-xs text-green-600 dark:text-green-400">
                  {{ $t('serverMode.title') }}
                </span>
                <span class="text-xs text-gray-400 dark:text-gray-500"> v{{ version }} </span>
              </div>
            </h1>
          </div>
          <div class="mx-auto sm:ml-auto sm:mr-0 flex items-center gap-2">
            <GitHubButton />
            <HistoryModal :disabled="isRunning" @load="loadHistoryItem" />
            <ConfigManager />
            <ColorModeButton />
            <LangSwitcher />
          </div>
        </div>

        <i18n-t class="whitespace-pre-wrap" keypath="index.projectDescription" tag="p">
          <UButton
            class="!p-0"
            variant="link"
            href="https://github.com/dzhng/deep-research"
            target="_blank"
          >
            dzhng/deep-research
          </UButton>
        </i18n-t>

        <ResearchSessionStatus
          :status="session.status"
          :phase="session.phase"
          :failure="session.failure"
          @cancel="cancelActiveOperation"
        />

        <ResearchForm
          v-model="form"
          :is-loading-feedback="isFeedbackRunning"
          :disabled="!canBeginFeedback"
          :submit-disabled="!canBeginFeedback"
          @submit="generateFeedback"
        />
        <ResearchFeedback
          ref="feedbackComponent"
          v-model="feedback"
          :is-loading-search="isResearchRunning"
          :disabled="session.status !== 'awaiting-input'"
          @submit="startDeepSearch"
        />
        <DeepResearch ref="deepResearch" :disabled="!canRetryResearch" @retry="retryResearchNode" />
        <ResearchReport
          ref="report"
          :disabled="!canRegenerateReport"
          :query="form.query"
          :result="researchResult"
          @regenerate="regenerateReport"
        />
      </div>
    </UContainer>
    <AutoUpdateToast />
  </div>
</template>

<script setup lang="ts">
  import type ResearchFeedback from '@/components/ResearchFeedback.vue'
  import type DeepResearch from '@/components/DeepResearch/DeepResearch.vue'
  import type ResearchReport from '@/components/ResearchReport.vue'
  import type { ResearchHistoryItem } from '~/types/history'
  import { useHistory } from '~/composables/useHistory'
  import type {
    ResearchFailure,
    ResearchFeedbackResult,
    ResearchInputData,
    ResearchOperationLease,
    ResearchPhase,
    ResearchResult,
  } from '~~/shared/types/research-session'
  import { isTimeoutError } from '~~/shared/utils/abort'

  const runtimeConfig = useRuntimeConfig()
  const { t } = useI18n()
  const version = runtimeConfig.public.version
  const isServerMode = runtimeConfig.public.serverMode

  const feedbackRef = useTemplateRef<InstanceType<typeof ResearchFeedback>>('feedbackComponent')
  const deepResearchRef = useTemplateRef<InstanceType<typeof DeepResearch>>('deepResearch')
  const reportRef = useTemplateRef<InstanceType<typeof ResearchReport>>('report')

  const form = ref<ResearchInputData>({
    query: '',
    breadth: 2,
    depth: 2,
    numQuestions: 3,
  })
  const feedback = ref<ResearchFeedbackResult[]>([])
  const researchResult = ref<ResearchResult>({
    learnings: [],
  })

  const {
    state: session,
    isRunning,
    canBeginFeedback,
    canRetryResearch,
    canRegenerateReport,
    beginFeedback,
    completeFeedback,
    beginResearch,
    beginResearchRetry,
    failResearchRetry,
    completeResearch,
    beginReport,
    completeReport,
    failOperation,
    requestCancellation,
    completeCancellation,
    timeoutOperation,
    loadHistory,
    isCurrentOperation,
  } = useResearchSession()
  const { addHistoryItem, updateHistoryItem } = useHistory()
  const operationRuntime = useResearchOperationRuntime({
    timeouts: {
      feedback: runtimeConfig.public.researchFeedbackTimeoutMs,
      research: runtimeConfig.public.researchResearchTimeoutMs,
      report: runtimeConfig.public.researchReportTimeoutMs,
    },
    onTimeout(lease, phase) {
      timeoutOperation(lease, phase, t('researchSession.timeoutMessage'))
    },
  })

  const isFeedbackRunning = computed(
    () => session.value.status === 'running' && session.value.phase === 'feedback',
  )
  const isResearchRunning = computed(
    () => session.value.status === 'running' && session.value.phase === 'research',
  )
  function operationGuard(lease: ResearchOperationLease) {
    return () => isCurrentOperation(lease.sessionId, lease.operationId)
  }

  function toFailure(phase: ResearchPhase, error: unknown): ResearchFailure {
    const message = error instanceof Error ? error.message : String(error)
    const isNetworkError =
      error instanceof TypeError || message.toLowerCase().includes('failed to fetch')
    return {
      phase,
      code: isNetworkError ? 'network' : 'unknown',
      message,
      retryable: true,
    }
  }

  function finishWithError(lease: ResearchOperationLease, phase: ResearchPhase, error: unknown) {
    if (isTimeoutError(error)) {
      timeoutOperation(lease, phase, t('researchSession.timeoutMessage'))
    } else {
      failOperation(lease, toFailure(phase, error))
    }
  }

  async function generateFeedback(input: ResearchInputData) {
    const lease = beginFeedback({ ...input })
    if (!lease) return
    const signal = operationRuntime.start(lease, 'feedback')

    deepResearchRef.value?.clear()
    reportRef.value?.displayReport('')
    researchResult.value = { learnings: [] }
    try {
      const result = await feedbackRef.value?.getFeedback({
        input: lease.input,
        isCurrent: operationGuard(lease),
        signal,
      })
      if (!isCurrentOperation(lease.sessionId, lease.operationId)) return
      if (!result) throw new Error(t('researchSession.noFeedback'))
      completeFeedback(lease, result)
    } catch (error) {
      finishWithError(lease, 'feedback', error)
    } finally {
      operationRuntime.finish(lease)
    }
  }

  async function startDeepSearch() {
    const lease = beginResearch(feedback.value)
    if (!lease) return
    const signal = operationRuntime.start(lease, 'research')

    try {
      const result = await deepResearchRef.value?.startResearch({
        input: lease.input,
        feedback: lease.feedback,
        isCurrent: operationGuard(lease),
        signal,
      })
      if (!isCurrentOperation(lease.sessionId, lease.operationId)) return
      if (!result?.learnings.length) throw new Error(t('researchSession.noLearnings'))
      researchResult.value = {
        learnings: result.learnings.map((item) => ({ ...item })),
      }

      const historyItem = addHistoryItem({
        title: lease.input.query,
        query: lease.input.query,
        breadth: lease.input.breadth,
        depth: lease.input.depth,
        numQuestions: lease.input.numQuestions,
        feedback: lease.feedback.map((item) => ({ ...item })),
        learnings: result.learnings.map((item) => ({ ...item })),
        report: '',
        graph: deepResearchRef.value?.exportGraph(),
      })
      const reportLease = completeResearch(lease, result, historyItem.id)
      operationRuntime.finish(lease)
      if (reportLease) await runReport(reportLease)
    } catch (error) {
      finishWithError(lease, 'research', error)
    } finally {
      operationRuntime.finish(lease)
    }
  }

  async function runReport(lease: ResearchOperationLease) {
    const historyId = session.value.historyId
    const signal = operationRuntime.start(lease, 'report')
    try {
      const report = await reportRef.value?.generateReport({
        input: lease.input,
        feedback: lease.feedback,
        result: lease.result,
        isCurrent: operationGuard(lease),
        signal,
      })
      if (!isCurrentOperation(lease.sessionId, lease.operationId)) return
      if (!report) throw new Error(t('researchSession.noReport'))

      if (historyId) {
        updateHistoryItem(historyId, {
          report,
          learnings: lease.result.learnings.map((item) => ({ ...item })),
          feedback: lease.feedback.map((item) => ({ ...item })),
        })
      }
      completeReport(lease, report)
    } catch (error) {
      finishWithError(lease, 'report', error)
    } finally {
      operationRuntime.finish(lease)
    }
  }

  async function retryResearchNode(nodeId: string) {
    let historyId = session.value.historyId
    const lease = beginResearchRetry()
    if (!lease) return
    const signal = operationRuntime.start(lease, 'research')

    try {
      const result = await deepResearchRef.value?.retryNode(nodeId, {
        input: lease.input,
        feedback: lease.feedback,
        isCurrent: operationGuard(lease),
        signal,
      })
      if (!isCurrentOperation(lease.sessionId, lease.operationId)) return
      if (!result?.learnings.length) throw new Error(t('researchSession.noLearnings'))

      researchResult.value = {
        learnings: result.learnings.map((item) => ({ ...item })),
      }
      reportRef.value?.displayReport('')
      const historyUpdates = {
        learnings: result.learnings.map((item) => ({ ...item })),
        feedback: lease.feedback.map((item) => ({ ...item })),
        report: '',
        graph: deepResearchRef.value?.exportGraph(),
      }
      if (historyId) {
        updateHistoryItem(historyId, historyUpdates)
      } else {
        historyId = addHistoryItem({
          title: lease.input.query,
          query: lease.input.query,
          breadth: lease.input.breadth,
          depth: lease.input.depth,
          numQuestions: lease.input.numQuestions,
          ...historyUpdates,
        }).id
      }
      const reportLease = completeResearch(lease, result, historyId)
      operationRuntime.finish(lease)
      if (reportLease) await runReport(reportLease)
    } catch (error) {
      if (isTimeoutError(error)) {
        timeoutOperation(lease, 'research', t('researchSession.timeoutMessage'))
      } else {
        failResearchRetry(lease)
      }
    } finally {
      operationRuntime.finish(lease)
    }
  }

  function cancelActiveOperation() {
    const lease = operationRuntime.currentLease()
    if (!lease || !requestCancellation(lease)) return
    operationRuntime.cancel(lease)
    completeCancellation(lease)
  }

  async function regenerateReport() {
    const lease = beginReport()
    if (lease) await runReport(lease)
  }

  function loadHistoryItem(item: ResearchHistoryItem) {
    if (!loadHistory(item)) return
    feedbackRef.value?.clear()
    reportRef.value?.displayReport('')

    form.value = {
      query: item.query,
      breadth: item.breadth,
      depth: item.depth,
      numQuestions: item.numQuestions,
    }
    feedback.value = item.feedback.map((entry) => ({ ...entry }))
    researchResult.value = {
      learnings: item.learnings.map((learning) => ({ ...learning })),
    }
    deepResearchRef.value?.importGraph(item.graph)
    reportRef.value?.displayReport(item.report || '')
  }
</script>
