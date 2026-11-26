import test from 'node:test'
import assert from 'node:assert/strict'
import { validateContract } from './contracts.js'

test('version-aware validation allows an explicit previous-version parent', () => {
  const parent = { id:'v1', name:'cdo.all', version:1, attributes:[{name:'position_id',data_type:'text'}], metrics:[] }
  const child = { id:'v2', name:'cdo.all', version:2, uses:{name:'cdo.all',version:1}, include:{attributes:['position_id'],metrics:[]}, attributes:[],metrics:[] }
  assert.deepEqual(validateContract(child,[parent,child]),[])
})

test('version-aware validation rejects a genuine cycle', () => {
  const a = { id:'a', name:'cdo.a',version:1,uses:{name:'cdo.b',version:1},include:{attributes:[],metrics:[]},attributes:[],metrics:[] }
  const b = { id:'b', name:'cdo.b',version:1,uses:{name:'cdo.a',version:1},include:{attributes:[],metrics:[]},attributes:[],metrics:[] }
  assert.match(validateContract(a,[a,b]).join(' '),/Circular/)
})

test('version-aware validation does not accept missing pinned parent version', () => {
  const parent = { id:'v2', name:'cdo.all',version:2, attributes:[],metrics:[] }
  const child = { id:'child',name:'cdo.child',version:1,uses:{name:'cdo.all',version:1},include:{attributes:[],metrics:[]},attributes:[],metrics:[] }
  assert.match(validateContract(child,[parent,child]).join(' '),/not found/)
})
