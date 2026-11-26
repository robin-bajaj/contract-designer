import test from 'node:test'
import assert from 'node:assert/strict'
import { fastValidateTeamModel } from './dbtCoreValidation.js'

const payload = {
  role:'team-a',sourceModel:'stg_test',semanticName:'test_semantic',
  sourceMode:'new',sourceSql:'select 1',yamlText:'version: 2',
}
test('sends unsaved SQL and YAML to local dbt validation API without GitHub token',async()=>{
  let url,options
  const response=await fastValidateTeamModel(payload,async(u,o)=>{
    url=u;options=o
    return {ok:true,json:async()=>({ok:true,steps:[{name:'dbt Core parse',status:'passed'}]})}
  })
  assert.equal(url,'/api/validate/fast')
  assert.equal(options.method,'POST')
  const body=JSON.parse(options.body)
  assert.deepEqual(body,payload)
  assert.equal(response.ok,true)
  assert.ok(!options.body.includes('Authorization'))
})

test('existing source model sends no unsaved SQL',async()=>{
  let body
  await fastValidateTeamModel({...payload,sourceMode:'existing'},async(u,o)=>{
    body=JSON.parse(o.body)
    return {ok:true,json:async()=>({ok:false,steps:[],error:'parse failed'})}
  })
  assert.equal(body.sourceSql,null)
})

test('backend offline response gives actionable setup instructions',async()=>{
  await assert.rejects(fastValidateTeamModel(payload,async()=>{throw Error('offline')}),/npm run dev:api/)
})

test('validation failures surface response details instead of discarding them',async()=>{
  const result=await fastValidateTeamModel(payload,async()=>({ok:false,json:async()=>({
    ok:false,error:'CDO inheritance compiler failed',log:'missing attr',steps:[],
  })}))
  assert.equal(result.ok,false)
  assert.equal(result.log,'missing attr')
})
