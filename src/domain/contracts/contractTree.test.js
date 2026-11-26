import test from 'node:test'
import assert from 'node:assert/strict'
import { buildContractTree, contractFilename } from './contractTree.js'

const contracts = [
  { id: 'all', name: 'cdo.all', version: 1, uses: null },
  { id: 'position', name: 'cdo.position', version: 1, uses: { name: 'cdo.all', version: 1 } },
  { id: 'leaf', name: 'cdo.equity', version: 1, uses: { name: 'cdo.position', version: 1 } },
  { id: 'other', name: 'other', version: 1, uses: null },
]
test('children are recursively nested under their referenced versioned parent', () => {
  const { roots } = buildContractTree(contracts)
  assert.deepEqual(roots.map(n => n.contract.name), ['cdo.all', 'other'])
  assert.equal(roots[0].children[0].contract.name, 'cdo.position')
  assert.equal(roots[0].children[0].children[0].contract.name, 'cdo.equity')
})
test('search keeps ancestor context without unrelated branches', () => {
  const { roots, matchingCount } = buildContractTree(contracts, 'equity')
  assert.equal(matchingCount, 1)
  assert.deepEqual(roots.map(n => n.contract.name), ['cdo.all'])
  assert.deepEqual(roots[0].children.map(n => n.contract.name), ['cdo.position'])
  assert.deepEqual(roots[0].children[0].children.map(n => n.contract.name), ['cdo.equity'])
})
test('missing parents and cyclic drafts remain visible', () => {
  const drafts = [{id:'a',name:'a',version:1,uses:{name:'b',version:1}},{id:'b',name:'b',version:1,uses:{name:'a',version:1}},{id:'orphan',name:'orphan',version:1,uses:{name:'nope',version:1}}]
  const tree = buildContractTree(drafts)
  const visit = nodes => nodes.flatMap(n => [n.contract.id, ...visit(n.children)])
  assert.deepEqual(visit(tree.roots).sort(), ['a', 'b', 'orphan'])
})
test('parent reference matches exact version, not just name', () => {
  const tree = buildContractTree([{ id:'parent',name:'cdo.all',version:2 },{id:'child',name:'cdo.position',version:1,uses:{name:'cdo.all',version:1}}])
  assert.equal(tree.roots.length,2)
})
test('YAML downloads retain the exact contract name', () => {
  assert.equal(contractFilename(contracts[1]), 'cdo.position.yml')
  assert.equal(contractFilename(contracts[0]), 'cdo.all.yml')
})
