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
            <HistoryModal @load="loadHistoryItem" />
            <ConfigManager ref="configManagerRef" />
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

        <ResearchForm
          :is-loading-feedback="!!feedbackRef?.isLoading"
          ref="formRef"
          @submit="generateFeedback"
        />
        <ResearchFeedback
          :is-loading-search="!!deepResearchRef?.isLoading"
          ref="feedbackRef"
          @submit="startDeepSearch"
        />
        <DeepResearch ref="deepResearchRef" @complete="handleResearchComplete" />
        <ResearchReport ref="reportRef" @complete="handleReportComplete" />
      </div>
    </UContainer>
    <AutoUpdateToast />
  </div>
</template>

<script setup lang="ts">
  import type ResearchForm from '@/components/ResearchForm.vue'
  import type ResearchFeedback from '@/components/ResearchFeedback.vue'
  import type DeepResearch from '@/components/DeepResearch/DeepResearch.vue'
  import type ResearchReport from '@/components/ResearchReport.vue'
  import type ConfigManager from '@/components/ConfigManager.vue'
  import type { ResearchInputData } from '@/components/ResearchForm.vue'
  import type { ResearchFeedbackResult } from '@/components/ResearchFeedback.vue'
  import type { ResearchResult } from '~~/lib/core/deep-research'
  import type { ResearchHistoryItem } from '~/types/history'
  import { useHistory } from '~/composables/useHistory'
  import {
    feedbackInjectionKey,
    formInjectionKey,
    researchResultInjectionKey,
  } from '@/constants/injection-keys'

  const runtimeConfig = useRuntimeConfig()
  const version = runtimeConfig.public.version
  const isServerMode = runtimeConfig.public.serverMode

  const configManagerRef = ref<InstanceType<typeof ConfigManager>>()
  const formRef = ref<InstanceType<typeof ResearchForm>>()
  const feedbackRef = ref<InstanceType<typeof ResearchFeedback>>()
  const deepResearchRef = ref<InstanceType<typeof DeepResearch>>()
  const reportRef = ref<InstanceType<typeof ResearchReport>>()

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

  provide(formInjectionKey, form)
  provide(feedbackInjectionKey, feedback)
  provide(researchResultInjectionKey, researchResult)

  async function generateFeedback() {
    feedbackRef.value?.getFeedback()
  }

  async function startDeepSearch() {
    deepResearchRef.value?.startResearch()
  }

  async function generateReport() {
    reportRef.value?.generateReport()
  }

  async function handleResearchComplete() {
    // 研究完成后立即保存历史记录（包含完整数据）
    const { addHistoryItem } = useHistory()
    if (researchResult.value.learnings.length > 0) {
      addHistoryItem({
        title: form.value.query,
        query: form.value.query,
        breadth: form.value.breadth,
        depth: form.value.depth,
        numQuestions: form.value.numQuestions,
        feedback: [...feedback.value],
        learnings: [...researchResult.value.learnings],
        report: '', // 初始为空，将在报告生成后通过 complete 事件更新
      })
    }

    // 触发报告生成
    await generateReport()
  }

  function handleReportComplete(report: string) {
    // 报告生成完成后更新历史记录
    const { updateHistoryItem, findHistoryItemByQuery } = useHistory()
    const existingItem = findHistoryItemByQuery(form.value.query)
    if (existingItem) {
      updateHistoryItem(existingItem.id, {
        report,
        learnings: [...researchResult.value.learnings],
        feedback: [...feedback.value],
      })
    }
  }

  function loadHistoryItem(item: ResearchHistoryItem) {
    // 加载历史记录
    form.value = {
      query: item.query,
      breadth: item.breadth,
      depth: item.depth,
      numQuestions: item.numQuestions,
    }

    feedback.value = [...item.feedback]
    researchResult.value = {
      learnings: [...item.learnings],
    }

    // 如果历史记录中有报告，直接显示，不重新生成
    if (item.report && reportRef.value) {
      nextTick(() => {
        reportRef.value?.displayReport(item.report)
      })
    }
  }
</script>
