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

test('curved lineage arrow begins at the actual parent bottom and ends above its child', () => {
  const contracts = [
    { id:'v1',name:'cdo.all',version:1 },
    { id:'v2',name:'cdo.all',version:2 },
    { id:'child',name:'cdo.position',version:1,uses:{name:'cdo.all',version:1} },
  ]
  // Simulate saved canvas positions: parents intentionally far apart.
  const positions = {v1:{x:100,y:100},v2:{x:850,y:100},child:{x:720,y:450}}
  const edges = lineageEdges(contracts,positions)
  assert.equal(edges.length,1)
  assert.equal(edges[0].from,'v1')
  assert.equal(edges[0].to,'child')
  assert.match(edges[0].path,/^M 201 250 C 201 /)
  assert.match(edges[0].path,/821 443$/)
  assert.doesNotMatch(edges[0].path,/\bH\b|\bV\b/)
})

test('two siblings each connect to the same version-pinned parent anchor', () => {
  const contracts = [
    {id:'all1',name:'cdo.all',version:1},
    {id:'all2',name:'cdo.all',version:2},
    {id:'a',name:'cdo.counterparty',version:1,uses:{name:'cdo.all',version:1}},
    {id:'b',name:'cdo.position',version:1,uses:{name:'cdo.all',version:1}},
  ]
  const positions={all1:{x:10,y:20},all2:{x:400,y:20},a:{x:90,y:360},b:{x:480,y:360}}
  const edges=lineageEdges(contracts,positions)
  assert.equal(edges.length,2)
  for (const edge of edges) assert.match(edge.path,/^M 111 170 C 111 /)
})
