import test from 'node:test'
import assert from 'node:assert/strict'
import { createLineageLayout, lineageEdges, NODE_HEIGHT } from './lineage.js'

const sample = [
  { id: 'all', name: 'cdo.all' },
  { id: 'position', name: 'cdo.position', uses: { name: 'cdo.all', version: 1 } },
  { id: 'counterparty', name: 'cdo.counterparty', uses: { name: 'cdo.all', version: 1 } },
]
test('child contracts appear below parents with no overlapping siblings', () => {
  const { positions, width } = createLineageLayout(sample)
  assert.ok(width >= 680)
  assert.ok(positions.position.y > positions.all.y + NODE_HEIGHT)
  assert.equal(positions.position.y, positions.counterparty.y)
  assert.notEqual(positions.position.x, positions.counterparty.x)
})
test('lineage edges follow parent and child positions', () => {
  const { positions } = createLineageLayout(sample)
  const edges = lineageEdges(sample, positions)
  assert.equal(edges.length, 2)
  assert.deepEqual(edges.map(e => e.id), ['all->position','all->counterparty'])
})
test('orphaned parents and cyclic drafts do not break layout', () => {
  const drafts = [{id:'a',name:'a',uses:{name:'b'}},{id:'b',name:'b',uses:{name:'a'}},{id:'missing',name:'m',uses:{name:'unknown'}}]
  const { positions } = createLineageLayout(drafts)
  assert.equal(Object.keys(positions).length, 3)
  assert.equal(lineageEdges(drafts, positions).length, 2)
})
