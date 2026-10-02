import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isAccessPasswordValid } from '../server/utils/access.ts'

describe('access password', () => {
  it('accepts only the exact URI-encoded password', () => {
    assert.equal(isAccessPasswordValid(encodeURIComponent('s3cret'), 's3cret'), true)
    assert.equal(isAccessPasswordValid(encodeURIComponent('s3cret '), 's3cret'), false)
    assert.equal(isAccessPasswordValid(encodeURIComponent('S3cret'), 's3cret'), false)
    assert.equal(isAccessPasswordValid(undefined, 's3cret'), false)
    assert.equal(isAccessPasswordValid('', 's3cret'), false)
  })

  it('supports non-ASCII passwords and rejects malformed encodings', () => {
    assert.equal(isAccessPasswordValid(encodeURIComponent('密码🔑'), '密码🔑'), true)
    assert.equal(isAccessPasswordValid('%E4%BD', '密码🔑'), false)
  })
})
