<script setup lang="ts">
  import type { ResearchHistoryItem } from '~/types/history'
  import { useHistory } from '~/composables/useHistory'

  const { t } = useI18n()
  const toast = useToast()
  const { history, removeHistoryItem, exportHistoryItem, importHistoryItem, clearHistory } =
    useHistory()
  const showModal = ref(false)
  const loading = ref(false)

  const sortedHistory = computed(() =>
    [...history.value.items].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    ),
  )

  const fileInput = ref<HTMLInputElement>()

  const handleImport = () => {
    fileInput.value?.click()
  }

  const handleFileSelect = async (event: Event) => {
    const file = (event.target as HTMLInputElement).files?.[0]
    if (!file) return

    loading.value = true
    try {
      await importHistoryItem(file)
      toast.add({
        title: t('history.importSuccess'),
        color: 'success',
      })
    } catch (error) {
      toast.add({
        title: t('history.importFailed'),
        description: error instanceof Error ? error.message : String(error),
        color: 'error',
      })
    } finally {
      loading.value = false
      if (fileInput.value) {
        fileInput.value.value = ''
      }
    }
  }

  const handleExportItem = (item: ResearchHistoryItem) => {
    exportHistoryItem(item)
  }

  const confirmDelete = (id: string) => {
    const item = history.value.items.find((item) => item.id === id)
    if (!item) return

    toast.add({
      title: t('history.confirmDelete'),
      description: item.title,
      actions: [
        {
          label: t('common.delete'),
          color: 'error',
          onClick: () => removeHistoryItem(id),
        },
        {
          label: t('common.cancel'),
          variant: 'subtle',
        },
      ],
    })
  }

  const confirmDeleteAll = () => {
    toast.add({
      title: t('history.confirmDeleteAll'),
      actions: [
        {
          label: t('common.delete'),
          color: 'error',
          onClick: () => {
            clearHistory()
          },
        },
        {
          label: t('common.cancel'),
          variant: 'subtle',
        },
      ],
    })
  }

  const loadHistoryItem = (item: ResearchHistoryItem) => {
    // 这里需要与主页面通信，加载历史记录
    emit('load', item as ResearchHistoryItem)
    showModal.value = false
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString()
  }

  const truncateText = (text: string, maxLength: number = 50) => {
    return text.length > maxLength ? text.substring(0, maxLength) + '...' : text
  }

  const emit = defineEmits<{
    (e: 'load', item: ResearchHistoryItem): void
  }>()
</script>

<template>
  <UModal v-model:open="showModal" :title="t('history.title')" size="xl">
    <UButton color="primary" variant="subtle" icon="i-lucide-history" @click="showModal = true" />
    <template #body>
      <div class="flex flex-col gap-4">
        <!-- 导入按钮和删除全部 -->
        <div class="flex gap-2 justify-between items-center">
          <div class="flex gap-2">
            <UButton
              color="info"
              variant="soft"
              icon="i-lucide-upload"
              @click="handleImport"
              :loading="loading"
            >
              {{ t('history.import') }}
            </UButton>
            <input
              ref="fileInput"
              type="file"
              accept=".json"
              class="hidden"
              @change="handleFileSelect"
            />
          </div>

          <UButton
            v-if="sortedHistory.length > 0"
            color="error"
            variant="ghost"
            icon="i-lucide-trash-2"
            @click="confirmDeleteAll"
          >
            {{ t('history.deleteAll') }}
          </UButton>
        </div>

        <!-- 历史记录列表 -->
        <div v-if="sortedHistory.length > 0" class="space-y-2 max-h-96 overflow-y-auto">
          <div
            v-for="item in sortedHistory"
            :key="item.id"
            class="border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            <div class="flex justify-between items-start">
              <div class="flex-1">
                <h3 class="font-semibold text-lg">{{ item.title }}</h3>
                <p class="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  {{ truncateText(item.query) }}
                </p>
                <div class="flex gap-4 text-xs text-gray-500 dark:text-gray-400 mt-2">
                  <span>{{ t('history.depth') }}: {{ item.depth }}</span>
                  <span>{{ t('history.breadth') }}: {{ item.breadth }}</span>
                  <span>{{ t('history.questions') }}: {{ item.numQuestions }}</span>
                </div>
                <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {{ formatDate(item.createdAt) }}
                </div>
              </div>
              <div class="flex gap-2 ml-4">
                <UButton
                  color="primary"
                  variant="ghost"
                  size="sm"
                  icon="i-lucide-folder-open"
                  @click="loadHistoryItem(item as ResearchHistoryItem)"
                >
                  {{ t('history.load') }}
                </UButton>
                <UButton
                  color="info"
                  variant="ghost"
                  size="sm"
                  icon="i-lucide-download"
                  @click="handleExportItem(item as ResearchHistoryItem)"
                >
                  {{ t('history.export') }}
                </UButton>
                <UButton
                  color="error"
                  variant="ghost"
                  size="sm"
                  icon="i-lucide-trash-2"
                  @click="confirmDelete(item.id)"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- 空状态 -->
        <div v-else class="text-center py-8">
          <UIcon name="i-lucide-history" size="48" class="text-gray-400 mb-4" />
          <p class="text-gray-500">{{ t('history.empty') }}</p>
        </div>
      </div>
    </template>
  </UModal>
</template>
