import test from 'node:test'
import assert from 'node:assert/strict'
import { restoreRegistryBaseline, persistRegistryBaseline, REGISTRY_BASELINE_KEY } from './registryCache.js'

test('only an explicit successful approved snapshot is persisted', () => {
  const state = new Map()
  const storage = { getItem: key => state.get(key) || null, setItem: (key,value) => state.set(key,value) }
  assert.deepEqual(restoreRegistryBaseline(storage), [])
  const approved = [{id:'github:cdo.all@1',name:'cdo.all',version:1,attributes:[],metrics:[]}]
  assert.equal(persistRegistryBaseline(approved,storage),true)
  assert.deepEqual(restoreRegistryBaseline(storage), approved)
  assert.ok(state.has(REGISTRY_BASELINE_KEY))
})

test('a corrupt or unavailable browser cache fails closed to an empty catalog', () => {
  assert.deepEqual(restoreRegistryBaseline({getItem:()=>'{invalid'}), [])
  assert.deepEqual(restoreRegistryBaseline({getItem:()=>{throw Error('Disabled')}}),[])
  assert.equal(persistRegistryBaseline([], {setItem:()=>{throw Error('Quota')}}),false)
})
