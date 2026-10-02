const DB_NAME = 'deep-research'
const STORE_NAME = 'kv'
const HISTORY_KEY = 'history'

let dbPromise: Promise<IDBDatabase> | undefined

function openHistoryDb() {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  }).catch((error) => {
    // Allow a later retry instead of caching the failure forever.
    dbPromise = undefined
    throw error
  })
  return dbPromise
}

function runHistoryRequest<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
) {
  return openHistoryDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, mode)
        const request = run(transaction.objectStore(STORE_NAME))
        transaction.oncomplete = () => resolve(request.result)
        transaction.onerror = () => reject(transaction.error ?? request.error)
        transaction.onabort = () => reject(transaction.error ?? request.error)
      }),
  )
}

/** Reads the persisted history blob from IndexedDB; `undefined` when nothing is stored yet. */
export function readHistoryFromIndexedDB(): Promise<unknown> {
  return runHistoryRequest('readonly', (store) => store.get(HISTORY_KEY))
}

/** `value` must be structured-cloneable (plain data, no Vue proxies). */
export async function writeHistoryToIndexedDB(value: unknown) {
  await runHistoryRequest('readwrite', (store) => store.put(value, HISTORY_KEY))
}
