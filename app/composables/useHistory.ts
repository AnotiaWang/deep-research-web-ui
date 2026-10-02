import type {
  NewResearchHistoryItem,
  ResearchHistory,
  ResearchHistoryItem,
  ResearchHistoryItemUpdates,
} from '~/types/history'
import {
  createResearchHistoryItem,
  HISTORY_ITEM_LIMIT,
  mergeHistoryItems,
  normalizeStoredHistory,
  parseImportedHistoryItem,
  updateResearchHistoryItem,
} from '~/utils/history'
import { readHistoryFromIndexedDB, writeHistoryToIndexedDB } from '~/utils/history-storage'

/** Pre-IndexedDB storage; still used as a fallback when IndexedDB is unavailable. */
const LEGACY_STORAGE_KEY = 'deep-research-history'
const PERSIST_DELAY_MS = 300

// Shared by every useHistory() caller in this tab.
const history = ref<ResearchHistory>({ items: [] })
let initialized = false
let loaded = false
let lastPersisted = ''
let persistTimer: ReturnType<typeof setTimeout> | undefined
let channel: BroadcastChannel | undefined

function readLegacyHistory(): unknown {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY)
    return raw ? JSON.parse(raw) : undefined
  } catch {
    return undefined
  }
}

async function readPersistedHistory() {
  try {
    const stored = await readHistoryFromIndexedDB()
    if (stored !== undefined) return { value: stored, legacy: false }
  } catch (error) {
    console.error('[history] IndexedDB unavailable, falling back to localStorage', error)
  }
  return { value: readLegacyHistory(), legacy: true }
}

async function persistHistory() {
  const serialized = JSON.stringify(history.value)
  if (serialized === lastPersisted) return
  try {
    await writeHistoryToIndexedDB(JSON.parse(serialized))
    // IndexedDB now owns the data; drop the migrated legacy copy.
    localStorage.removeItem(LEGACY_STORAGE_KEY)
  } catch (error) {
    console.error('[history] Failed to write IndexedDB, falling back to localStorage', error)
    try {
      localStorage.setItem(LEGACY_STORAGE_KEY, serialized)
    } catch (fallbackError) {
      console.error('[history] Failed to persist research history', fallbackError)
      return
    }
  }
  lastPersisted = serialized
  channel?.postMessage('updated')
}

async function loadPersistedHistory() {
  const { value, legacy } = await readPersistedHistory()
  const persisted = normalizeStoredHistory(value)
  // Leave legacy data marked unsaved so the first persist migrates it into IndexedDB.
  lastPersisted = legacy ? '' : JSON.stringify(persisted)
  history.value = { items: mergeHistoryItems(history.value.items, persisted.items) }
  loaded = true
}

function initHistory() {
  if (initialized || !import.meta.client) return
  initialized = true
  void loadPersistedHistory()
  watch(
    history,
    () => {
      // Never overwrite stored history with the empty pre-load state.
      if (!loaded) return
      clearTimeout(persistTimer)
      persistTimer = setTimeout(persistHistory, PERSIST_DELAY_MS)
    },
    { deep: true },
  )
  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel(LEGACY_STORAGE_KEY)
    channel.onmessage = async () => {
      const { value } = await readPersistedHistory()
      const persisted = normalizeStoredHistory(value)
      lastPersisted = JSON.stringify(persisted)
      history.value = persisted
    }
  }
}

export const useHistory = () => {
  initHistory()

  const addHistoryItem = (item: NewResearchHistoryItem): ResearchHistoryItem => {
    const newItem = createResearchHistoryItem(item)

    history.value.items.unshift(newItem)

    if (history.value.items.length > HISTORY_ITEM_LIMIT) {
      history.value.items = history.value.items.slice(0, HISTORY_ITEM_LIMIT)
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

            if (history.value.items.length > HISTORY_ITEM_LIMIT) {
              history.value.items = history.value.items.slice(0, HISTORY_ITEM_LIMIT)
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
