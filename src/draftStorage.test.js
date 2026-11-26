import test from 'node:test'
import assert from 'node:assert/strict'
import { DRAFT_STORAGE_KEY, restoreContracts, persistContracts } from './draftStorage.js'

test('draft contracts survive a reload', () => {
  const state = new Map()
  const storage = { getItem: key => state.get(key) ?? null, setItem: (key, value) => state.set(key, value) }
  const contracts = restoreContracts(storage)
  contracts[0].description = 'New draft'
  assert.equal(persistContracts(contracts, storage), true)
  assert.equal(restoreContracts(storage)[0].description, 'New draft')
  assert.ok(state.has(DRAFT_STORAGE_KEY))
})
test('invalid stored drafts fall back to seeds', () => {
  const storage = { getItem: () => '{bad json' }
  assert.equal(restoreContracts(storage)[0].name, 'cdo.all')
})
