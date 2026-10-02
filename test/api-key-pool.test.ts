import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { ApiKeyPool } from '../server/utils/api-key-pool.ts'

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
})
