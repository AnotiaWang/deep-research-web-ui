import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isChildNode, isParentNode, parentNodeId } from '../app/utils/tree-node.ts'

describe('tree node relationships', () => {
  it('finds the immediate parent of nested nodes', () => {
    assert.equal(parentNodeId('0'), undefined)
    assert.equal(parentNodeId('0-1'), '0')
    assert.equal(parentNodeId('0-1-2'), '0-1')
  })

  it('matches ancestors and descendants by complete path segments', () => {
    assert.equal(isParentNode('0', '0-1-2'), true)
    assert.equal(isParentNode('0-1', '0-1-2'), true)
    assert.equal(isParentNode('0-1', '0-10-2'), false)

    assert.equal(isChildNode('0', '0-1-2'), true)
    assert.equal(isChildNode('0-1', '0-1-2'), true)
    assert.equal(isChildNode('0-1', '0-10-2'), false)
    assert.equal(isChildNode('0-1', '0-1'), false)
  })
})
