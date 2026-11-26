import test from 'node:test'
import assert from 'node:assert/strict'
import { validateStagingDraft } from './stagingValidation.js'

test('validates unsaved staging SQL without semantic model YAML or a GitHub token', async()=>{
  let url,options
  const result=await validateStagingDraft({role:'team-a',sourceModel:'stg_new_a',sourceSql:'select 1'},async(u,o)=>{
    url=u;options=o
    return {status:200,json:async()=>({ok:true,scope:'staging',steps:[{name:'dbt Core parse',status:'passed'}]})}
  })
  assert.equal(url,'/api/validate/staging')
  const body=JSON.parse(options.body)
  assert.deepEqual(body,{role:'team-a',sourceModel:'stg_new_a',sourceMode:'new',sourceSql:'select 1'})
  assert.equal(result.ok,true)
})

test('busy responses are not treated as invalid SQL',async()=>{
  const result=await validateStagingDraft({role:'team-c',sourceModel:'fi_new',sourceSql:'select 1'},async()=>({
    status:429,json:async()=>({ok:false,error:'Validation service busy'}),
  }))
  assert.equal(result.busy,true)
})

test('network failure identifies backend availability rather than SQL failure',async()=>{
  await assert.rejects(validateStagingDraft({role:'team-a',sourceModel:'a',sourceSql:'select 1'},async()=>{throw Error('network')}),/npm run dev:api/)
})

test('request abort is propagated for stale edits',async()=>{
  const error=new Error('cancelled');error.name='AbortError'
  await assert.rejects(validateStagingDraft({role:'team-a',sourceModel:'a',sourceSql:'select 1'},async()=>{throw error}),e=>e.name==='AbortError')
})
