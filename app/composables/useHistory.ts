import type {
  NewResearchHistoryItem,
  ResearchHistory,
  ResearchHistoryItem,
  ResearchHistoryItemUpdates,
} from '~/types/history'
import {
  createResearchHistoryItem,
  normalizeStoredHistory,
  parseImportedHistoryItem,
  updateResearchHistoryItem,
} from '~/utils/history'

export const useHistory = () => {
  const history = useLocalStorage<ResearchHistory>('deep-research-history', {
    items: [],
  })
  history.value = normalizeStoredHistory(history.value)

  const addHistoryItem = (item: NewResearchHistoryItem): ResearchHistoryItem => {
    const newItem = createResearchHistoryItem(item)

    history.value.items.unshift(newItem)

    // 限制历史记录数量，最多保存100条
    if (history.value.items.length > 100) {
      history.value.items = history.value.items.slice(0, 100)
    }
    return newItem
  }

  const removeHistoryItem = (id: string) => {
    history.value.items = history.value.items.filter((item) => item.id !== id)
  }

  const clearHistory = () => {
    history.value.items = []
  }

  const exportHistoryItem = (item: ResearchHistoryItem) => {
    const dataStr = JSON.stringify(item, null, 2)
    const dataBlob = new Blob([dataStr], { type: 'application/json' })

    const url = URL.createObjectURL(dataBlob)
    const link = document.createElement('a')
    link.href = url
    link.download = `research-${item.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}-${new Date().toISOString().split('T')[0]}.json`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const importHistoryItem = (file: File) => {
    return new Promise<ResearchHistoryItem>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (e) => {
        try {
          const importedItem = parseImportedHistoryItem(JSON.parse(e.target?.result as string))
          const existingIndex = history.value.items.findIndex((item) => item.id === importedItem.id)
          if (existingIndex >= 0) {
            history.value.items[existingIndex] = importedItem
          } else {
            history.value.items.unshift(importedItem)

            if (history.value.items.length > 100) {
              history.value.items = history.value.items.slice(0, 100)
            }
          }
          resolve(importedItem)
        } catch (error) {
          reject(error)
        }
      }
      reader.onerror = () => reject(new Error('Failed to read file'))
      reader.readAsText(file)
    })
  }

  const updateHistoryItem = (id: string, updates: ResearchHistoryItemUpdates) => {
    const index = history.value.items.findIndex((item) => item.id === id)
    if (index >= 0) {
      const newItem = updateResearchHistoryItem(history.value.items, id, updates)!
      history.value.items.splice(index, 1, newItem)
      return newItem
    }
    return null
  }

  return {
    history: readonly(history),
    addHistoryItem,
    removeHistoryItem,
    clearHistory,
    exportHistoryItem,
    importHistoryItem,
    updateHistoryItem,
  }
}
