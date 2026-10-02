import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { isAbortError } from '~~/shared/utils/abort'

interface ApiKeyState {
  key: string
  active: boolean
  errorCount: number
}

/** On-disk shape: keys are identified by fingerprint, never stored in plaintext. */
interface PersistedPoolState {
  currentIndex: number
  keys: Array<{ fingerprint: string; active: boolean; errorCount: number }>
}

const MAX_ERRORS = 5
const PERSIST_DELAY_MS = 1000

function fingerprint(key: string) {
  return createHash('sha256').update(key).digest('hex').slice(0, 16)
}

export class ApiKeyPool {
  private currentIndex = 0
  private readonly keys: ApiKeyState[]
  private readonly cacheFilePath: string
  private readonly providerName: string
  private persistTimer: ReturnType<typeof setTimeout> | undefined

  constructor(keys: string[], providerName: string, cacheDir = path.join(process.cwd(), '.cache')) {
    this.providerName = providerName
    this.cacheFilePath = path.join(cacheDir, `keypool_${providerName}.json`)
    this.keys = keys.map((key) => ({ key, active: true, errorCount: 0 }))
    this.restore()
  }

  /** Restores health state only when the configured key set is unchanged. */
  private restore() {
    let saved: PersistedPoolState
    try {
      if (!fs.existsSync(this.cacheFilePath)) return
      saved = JSON.parse(fs.readFileSync(this.cacheFilePath, 'utf8'))
    } catch (error: any) {
      console.error(
        `[ApiKeyPool] Could not read ${this.cacheFilePath}, starting fresh.`,
        error?.message,
      )
      return
    }
    const savedKeys = Array.isArray(saved?.keys) ? saved.keys : []
    const byFingerprint = new Map(savedKeys.map((entry) => [entry?.fingerprint, entry]))
    const matches =
      savedKeys.length === this.keys.length &&
      this.keys.every((state) => byFingerprint.has(fingerprint(state.key)))
    if (!matches) {
      // Legacy plaintext files or a changed key set: overwrite with a fresh state.
      this.schedulePersist()
      return
    }
    for (const state of this.keys) {
      const entry = byFingerprint.get(fingerprint(state.key))!
      state.active = entry.active !== false
      state.errorCount = Number.isInteger(entry.errorCount) ? entry.errorCount : 0
    }
    this.currentIndex = Number.isInteger(saved.currentIndex) ? saved.currentIndex : 0
  }

  private schedulePersist() {
    if (this.persistTimer) return
    this.persistTimer = setTimeout(() => {
      this.persistTimer = undefined
      void this.persist()
    }, PERSIST_DELAY_MS)
    this.persistTimer.unref?.()
  }

  /** Writes any pending state immediately. */
  async flush() {
    if (!this.persistTimer) return
    clearTimeout(this.persistTimer)
    this.persistTimer = undefined
    await this.persist()
  }

  private async persist() {
    const state: PersistedPoolState = {
      currentIndex: this.currentIndex,
      keys: this.keys.map(({ key, active, errorCount }) => ({
        fingerprint: fingerprint(key),
        active,
        errorCount,
      })),
    }
    try {
      await fs.promises.mkdir(path.dirname(this.cacheFilePath), { recursive: true })
      await fs.promises.writeFile(this.cacheFilePath, JSON.stringify(state, null, 2))
    } catch (error: any) {
      console.error(`[ApiKeyPool] Could not write ${this.cacheFilePath}.`, error?.message)
    }
  }

  getNextKey(): string | null {
    const activeKeys = this.keys.filter((k) => k.active)
    if (activeKeys.length === 0) return null
    if (this.currentIndex >= activeKeys.length) this.currentIndex = 0
    const selected = activeKeys[this.currentIndex]!
    this.currentIndex = (this.currentIndex + 1) % activeKeys.length
    this.schedulePersist()
    return selected.key
  }

  markKeyError(key: string) {
    const state = this.keys.find((k) => k.key === key)
    if (!state) return
    state.errorCount++
    if (state.errorCount >= MAX_ERRORS && state.active) {
      state.active = false
      console.error(
        `[ApiKeyPool] Disabling ${this.providerName} key ${fingerprint(key)} after repeated errors.`,
      )
    }
    this.schedulePersist()
  }

  markKeySuccess(key: string) {
    const state = this.keys.find((k) => k.key === key)
    if (!state || state.errorCount === 0) return
    state.errorCount = 0
    this.schedulePersist()
  }

  /**
   * Runs `request` with the next active key and records the outcome.
   * Aborts never count against a key; `isKeyError` narrows which failures do.
   */
  async withKey<T>(
    request: (key: string) => Promise<T>,
    options: {
      label: string
      signal?: AbortSignal
      isKeyError?: (error: unknown) => boolean
    },
  ): Promise<T> {
    const key = this.getNextKey()
    if (!key) throw new Error(`No active ${options.label} API keys available.`)
    try {
      const result = await request(key)
      this.markKeySuccess(key)
      return result
    } catch (error) {
      if (options.signal?.aborted || isAbortError(error)) throw error
      if (options.isKeyError?.(error) ?? true) this.markKeyError(key)
      throw error
    }
  }
}

export function parseApiKeys(envValue: string | undefined, envName: string): string[] {
  if (!envValue) {
    throw new Error(`${envName} environment variable not set.`)
  }
  const keys = envValue
    .split(',')
    .map((key) => key.trim())
    .filter((key) => key)
  if (keys.length === 0) {
    throw new Error(`${envName} environment variable is empty or contains only commas.`)
  }
  return keys
}

const pools = new Map<string, ApiKeyPool>()

/** One pool per provider for the lifetime of the server process. */
export function getApiKeyPool(providerName: string, rawKeys: string | undefined) {
  let pool = pools.get(providerName)
  if (!pool) {
    pool = new ApiKeyPool(parseApiKeys(rawKeys, 'NUXT_WEB_SEARCH_API_KEY'), providerName)
    pools.set(providerName, pool)
  }
  return pool
}
