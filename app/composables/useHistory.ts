import type { ResearchHistory, ResearchHistoryItem } from '~/types/history'

export const useHistory = () => {
  const history = useLocalStorage<ResearchHistory>('deep-research-history', {
    items: [],
  })

  const addHistoryItem = (item: Omit<ResearchHistoryItem, 'id' | 'createdAt' | 'updatedAt'>) => {
    const newItem: ResearchHistoryItem = {
      ...item,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    history.value.items.unshift(newItem)

    // 限制历史记录数量，最多保存100条
    if (history.value.items.length > 100) {
      history.value.items = history.value.items.slice(0, 100)
    }
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
          const importedItem = JSON.parse(e.target?.result as string) as ResearchHistoryItem
          if (importedItem && importedItem.id && importedItem.query) {
            // 检查是否已存在相同ID
            const existingIndex = history.value.items.findIndex(
              (item) => item.id === importedItem.id,
            )
            if (existingIndex >= 0) {
              // 更新现有记录
              history.value.items[existingIndex] = {
                ...importedItem,
                updatedAt: new Date().toISOString(),
              }
            } else {
              // 添加新记录
              const newItem: ResearchHistoryItem = {
                ...importedItem,
                id: importedItem.id || crypto.randomUUID(),
                createdAt: importedItem.createdAt || new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              }
              history.value.items.unshift(newItem)

              // 限制历史记录数量
              if (history.value.items.length > 100) {
                history.value.items = history.value.items.slice(0, 100)
              }
            }
            resolve(importedItem)
          } else {
            reject(new Error('Invalid history item format'))
          }
        } catch (error) {
          reject(error)
        }
      }
      reader.onerror = () => reject(new Error('Failed to read file'))
      reader.readAsText(file)
    })
  }

  const updateHistoryItem = (id: string, updates: Partial<ResearchHistoryItem>) => {
    const index = history.value.items.findIndex((item) => item.id === id)
    if (index >= 0) {
      const newItem = {
        ...history.value.items[index],
        ...updates,
        updatedAt: new Date().toISOString(),
      } as ResearchHistoryItem
      history.value.items.splice(index, 1, newItem)
      return newItem
    }
    return null
  }

  const findHistoryItemByQuery = (query: string) => {
    return history.value.items.find((item) => item.query === query)
  }

  return {
    history: readonly(history),
    addHistoryItem,
    removeHistoryItem,
    clearHistory,
    exportHistoryItem,
    importHistoryItem,
    updateHistoryItem,
    findHistoryItemByQuery,
  }
}
