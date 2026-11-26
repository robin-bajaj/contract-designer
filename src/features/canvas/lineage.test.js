import test from 'node:test'
import assert from 'node:assert/strict'
import { createLineageLayout, lineageEdges, NODE_HEIGHT } from './lineage.js'

const sample = [
  { id: 'all', name: 'cdo.all', version: 1 },
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
  const drafts = [{id:'a',name:'a',version:1,uses:{name:'b',version:1}},{id:'b',name:'b',version:1,uses:{name:'a',version:1}},{id:'missing',name:'m',version:1,uses:{name:'unknown',version:1}}]
  const { positions } = createLineageLayout(drafts)
  assert.equal(Object.keys(positions).length, 3)
  assert.equal(lineageEdges(drafts, positions).length, 2)
})

test('canvas and folder lineage both connect children only to cdo.all v1, never v2', () => {
  const contracts = [
    { id: 'all-v1', name: 'cdo.all', version: 1 },
    { id: 'all-v2', name: 'cdo.all', version: 2 },
    { id: 'position-v1', name: 'cdo.position', version: 1, uses: {name:'cdo.all',version:1} },
    { id: 'counterparty-v1', name: 'cdo.counterparty', version: 1, uses: {name:'cdo.all',version:1} },
  ]
  const { positions } = createLineageLayout(contracts)
  const edges = lineageEdges(contracts, positions)
  assert.deepEqual(edges.map(e => e.id), [
    'all-v1->position-v1',
    'all-v1->counterparty-v1',
  ])
  assert.equal(positions['all-v1'].y, positions['all-v2'].y)
  assert.ok(positions['position-v1'].y > positions['all-v1'].y)
})

test('missing pinned version must not link to another version', () => {
  const contracts = [
    { id: 'all-v2', name: 'cdo.all', version: 2 },
    { id: 'child', name: 'cdo.position', version: 1, uses: {name:'cdo.all',version:1} },
  ]
  const { positions } = createLineageLayout(contracts)
  assert.equal(lineageEdges(contracts, positions).length, 0)
  assert.equal(positions.child.y, positions['all-v2'].y)
})
