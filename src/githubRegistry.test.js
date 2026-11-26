import test from 'node:test'
import assert from 'node:assert/strict'
import { initialContracts } from './contracts.js'
import { mergeRegistryContracts, parseRegistryContract, fetchGovernanceContracts } from './githubRegistry.js'

test('imports versioned children preserving their parent reference', () => {
  const child = parseRegistryContract('name: cdo.position\\nversion: 2\\nuses:\\n  name: cdo.all\\n  version: 1\\ninclude:\\n  attributes: [position_id]\\n  metrics: []\\n')
  assert.equal(child.uses.version, 1)
  assert.equal(child.id, 'github:cdo.position@2')
})
test('preserves local edits while adding newly published contracts', () => {
  const local = structuredClone(initialContracts)
  local[0].attributes[0].description = 'Locally edited'
  const remote = structuredClone(initialContracts)
  remote[0].attributes[0].description = 'Changed on GitHub'
  remote.push(parseRegistryContract('name: cdo.new\\nversion: 1\\nattributes: []\\nmetrics: []\\n'))
  const merged = mergeRegistryContracts(local, remote)
  assert.equal(merged.contracts[0].attributes[0].description, 'Locally edited')
  assert.equal(merged.added, 1)
  assert.equal(merged.preserved, 1)
})
test('refreshes pristine seed from the registry', () => {
  const remote = structuredClone(initialContracts)
  remote[0].attributes[0].description = 'Canonical on GitHub'
  const merged = mergeRegistryContracts(structuredClone(initialContracts), remote)
  assert.equal(merged.contracts[0].attributes[0].description, 'Canonical on GitHub')
})
test('does not remove local drafts absent from the registry', () => {
  const local = [...structuredClone(initialContracts), parseRegistryContract('name: my.draft\\nversion: 1\\nattributes: []\\nmetrics: []\\n')]
  assert.equal(mergeRegistryContracts(local, initialContracts).contracts.length, local.length)
})
test('loads YAML through the Github API', async () => {
  const fetchImpl = async (url) => url.includes('?ref=main') && !url.includes('demo.yml')
    ? {ok:true,json:async()=>[{type:'file',name:'demo.yml'}]}
    : {ok:true,text:async()=> 'name: cdo.demo\\nversion: 1\\nattributes: []\\nmetrics: []\\n'}
  const contracts = await fetchGovernanceContracts(fetchImpl)
  assert.equal(contracts[0].name,'cdo.demo')
})
