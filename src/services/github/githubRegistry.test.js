import test from 'node:test'
import assert from 'node:assert/strict'
import { parseRegistryContract, fetchGovernanceContracts } from './githubRegistry.js'

test('imports versioned child contract retaining exact parent version', () => {
  const doc = 'name: cdo.position\nversion: 2\nuses:\n  name: cdo.all\n  version: 1\ninclude:\n  attributes: [position_id]\n  metrics: []\n'
  const child = parseRegistryContract(doc)
  assert.equal(child.uses.name, 'cdo.all')
  assert.equal(child.uses.version, 1)
  assert.equal(child.id, 'github:cdo.position@2')
})

test('public registry uses raw YAML rather than requesting each file from the GitHub API', async () => {
  const calls = []
  const fetchImpl = async url => {
    calls.push(url)
    if (url.includes('/contents/contracts?ref=main')) {
      return { ok: true, json: async () => [{ name: 'cdo_all_v1.yml', type: 'file' }] }
    }
    if (url.includes('raw.githubusercontent.com/')) {
      return { ok: true, text: async () => 'name: cdo.all\nversion: 1\nattributes: []\nmetrics: []\n' }
    }
    throw Error('Unexpected request: ' + url)
  }
  const contracts = await fetchGovernanceContracts(fetchImpl)
  assert.equal(contracts[0].name, 'cdo.all')
  assert.equal(calls.length, 2)
})

test('HTTP 429 listing falls back to CDN metadata', async () => {
  const calls = []
  const fetchImpl = async url => {
    calls.push(url)
    if (url.includes('/contents/contracts?ref=main')) return { ok: false, status: 429 }
    if (url.includes('data.jsdelivr.com/')) return { ok: true, json: async () => ({ files: [{ name: '/contracts/cdo_position_v1.yml' }, { name: '/README.md' }] }) }
    if (url.includes('raw.githubusercontent.com/')) return { ok: true, text: async () => 'name: cdo.position\nversion: 1\nuses:\n  name: cdo.all\n  version: 1\ninclude:\n  attributes: []\n  metrics: []\n' }
    throw Error('Unexpected request: ' + url)
  }
  const result = await fetchGovernanceContracts(fetchImpl)
  assert.equal(result.length, 1)
  assert.equal(result[0].name, 'cdo.position')
  assert.equal(calls.length, 3)
})

test('raw file errors fall back to CDN YAML content', async () => {
  const fetchImpl = async url => {
    if (url.includes('/contents/contracts?ref=main')) return { ok: true, json: async () => [{ name: 'cdo_all_v1.yml', type: 'file' }] }
    if (url.includes('raw.githubusercontent.com/')) return { ok: false, status: 429 }
    return { ok: true, text: async () => 'name: cdo.all\nversion: 1\nattributes: []\nmetrics: []\n' }
  }
  assert.equal((await fetchGovernanceContracts(fetchImpl))[0].name, 'cdo.all')
})
