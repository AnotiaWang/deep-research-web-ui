import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { ApiKeyPool, KEY_COOLDOWN_MS, isTransientError } from '../server/utils/api-key-pool.ts'

let cacheDir: string

beforeEach(() => {
  cacheDir = mkdtempSync(path.join(tmpdir(), 'api-key-pool-test-'))
})

afterEach(() => {
  rmSync(cacheDir, { recursive: true, force: true })
})

const cacheFile = () => path.join(cacheDir, 'keypool_test.json')

describe('ApiKeyPool', () => {
  it('rotates keys and persists fingerprints instead of plaintext keys', async () => {
    const pool = new ApiKeyPool(['secret-one', 'secret-two'], 'test', cacheDir)
    assert.equal(pool.getNextKey(), 'secret-one')
    assert.equal(pool.getNextKey(), 'secret-two')
    assert.equal(pool.getNextKey(), 'secret-one')
    await pool.flush()

    const saved = readFileSync(cacheFile(), 'utf8')
    assert.doesNotMatch(saved, /secret-/)
    assert.equal(JSON.parse(saved).keys.length, 2)
  })

  it('restores disabled keys only while the configured key set is unchanged', async () => {
    const pool = new ApiKeyPool(['secret-one', 'secret-two'], 'test', cacheDir)
    for (let i = 0; i < 5; i++) pool.markKeyError('secret-one')
    await pool.flush()

    const restored = new ApiKeyPool(['secret-two', 'secret-one'], 'test', cacheDir)
    assert.equal(restored.getNextKey(), 'secret-two')
    assert.equal(restored.getNextKey(), 'secret-two')

    const changed = new ApiKeyPool(['secret-one', 'secret-three'], 'test', cacheDir)
    assert.equal(changed.getNextKey(), 'secret-one')
  })

  it('replaces legacy plaintext cache files', async () => {
    writeFileSync(
      cacheFile(),
      JSON.stringify({
        currentIndex: 0,
        keys: [{ key: 'secret-one', active: false, errorCount: 5, maxErrors: 5 }],
      }),
    )
    const pool = new ApiKeyPool(['secret-one'], 'test', cacheDir)
    assert.equal(pool.getNextKey(), 'secret-one')
    await pool.flush()
    assert.doesNotMatch(readFileSync(cacheFile(), 'utf8'), /secret-one/)
  })

  it('does not count aborts or filtered failures against a key', async () => {
    const pool = new ApiKeyPool(['secret-one'], 'test', cacheDir)
    const pageError = Object.assign(new Error('page failed'), { response: { status: 500 } })
    for (let i = 0; i < 6; i++) {
      await assert.rejects(
        pool.withKey(
          async () => {
            throw pageError
          },
          { label: 'Test', isKeyError: () => false },
        ),
      )
    }
    const controller = new AbortController()
    controller.abort()
    for (let i = 0; i < 6; i++) {
      await assert.rejects(
        pool.withKey(
          async () => {
            throw new Error('aborted')
          },
          { label: 'Test', signal: controller.signal },
        ),
      )
    }
    assert.equal(await pool.withKey(async (key) => key, { label: 'Test' }), 'secret-one')

    for (let i = 0; i < 5; i++) {
      await assert.rejects(
        pool.withKey(
          async () => {
            throw new Error('unauthorized')
          },
          { label: 'Test' },
        ),
      )
    }
    await assert.rejects(
      pool.withKey(async (key) => key, { label: 'Test' }),
      /No active Test API keys available/,
    )
    await pool.flush()
  })
  it('retries a disabled key after the cooldown and disables it again on the next failure', async () => {
    let now = 1_000
    const pool = new ApiKeyPool(['secret-one'], 'test', cacheDir, () => now)
    for (let i = 0; i < 5; i++) pool.markKeyError('secret-one')
    assert.equal(pool.getNextKey(), null)

    now += KEY_COOLDOWN_MS - 1
    assert.equal(pool.getNextKey(), null)
    now += 1
    assert.equal(pool.getNextKey(), 'secret-one')

    pool.markKeyError('secret-one')
    assert.equal(pool.getNextKey(), null)
    now += KEY_COOLDOWN_MS
    assert.equal(pool.getNextKey(), 'secret-one')
    pool.markKeySuccess('secret-one')
    for (let i = 0; i < 4; i++) pool.markKeyError('secret-one')
    assert.equal(pool.getNextKey(), 'secret-one')
    await pool.flush()
  })

  it('keeps the cooldown across restarts and revives keys disabled by older versions', async () => {
    let now = 1_000
    const pool = new ApiKeyPool(['secret-one'], 'test', cacheDir, () => now)
    for (let i = 0; i < 5; i++) pool.markKeyError('secret-one')
    await pool.flush()
    assert.equal(new ApiKeyPool(['secret-one'], 'test', cacheDir, () => now).getNextKey(), null)

    const saved = JSON.parse(readFileSync(cacheFile(), 'utf8'))
    delete saved.keys[0].disabledUntil
    writeFileSync(cacheFile(), JSON.stringify(saved))
    const legacy = new ApiKeyPool(['secret-one'], 'test', cacheDir, () => now)
    assert.equal(legacy.getNextKey(), 'secret-one')
    await legacy.flush()
  })

  it('does not count network failures or upstream 5xx against a key by default', async () => {
    const pool = new ApiKeyPool(['secret-one'], 'test', cacheDir)
    const transient = [
      new TypeError('fetch failed'),
      Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }),
      Object.assign(new Error('bad gateway'), { response: { status: 502 } }),
      new Error('Google PSE Error: HTTP 503', {
        cause: Object.assign(new Error('HTTP 503'), { status: 503 }),
      }),
    ]
    for (let i = 0; i < 2; i++) {
      for (const error of transient) {
        await assert.rejects(
          pool.withKey(
            async () => {
              throw error
            },
            { label: 'Test' },
          ),
        )
      }
    }
    assert.equal(await pool.withKey(async (key) => key, { label: 'Test' }), 'secret-one')
    await pool.flush()
  })

  it('treats auth and quota responses as key errors', () => {
    for (const status of [401, 402, 403, 429]) {
      assert.equal(isTransientError(Object.assign(new Error('x'), { status })), false)
      assert.equal(isTransientError({ response: { status } }), false)
    }
    assert.equal(isTransientError(new Error('unauthorized')), false)
  })
})
