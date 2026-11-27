import test from 'node:test'
import assert from 'node:assert/strict'
import { toContractDocument, validateContract } from './contracts.js'
import yaml from 'js-yaml'

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

test('standalone contract description is included in live YAML and changes with edits', () => {
  const contract = {
    id:'all-v1', name:'cdo.all', version:1,
    description:'Shared business definitions for position and counterparty',
    attributes:[{name:'position_id',data_type:'text',description:'Position identifier'}],
    metrics:[],
  }
  const first = yaml.load(yaml.dump(toContractDocument(contract)))
  assert.equal(first.name,'cdo.all')
  assert.equal(first.description, contract.description)
  assert.equal(first.attributes[0].description,'Position identifier')
  const updated = yaml.load(yaml.dump(toContractDocument({...contract,description:'Updated business meaning'})))
  assert.equal(updated.description,'Updated business meaning')
})

test('blank descriptions are omitted and child YAML stays compatible with strict registry schema', () => {
  const standalone = {name:'cdo.all',version:2,description:'   ',attributes:[],metrics:[]}
  assert.equal('description' in toContractDocument(standalone),false)
  const child = {
    name:'cdo.position',version:1,description:'Local editor description',
    uses:{name:'cdo.all',version:1},include:{attributes:['position_id'],metrics:[]},
    attributes:[],metrics:[],
  }
  assert.deepEqual(Object.keys(toContractDocument(child)).sort(),['include','name','uses','version'])
})
