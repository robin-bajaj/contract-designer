import test from 'node:test'
import assert from 'node:assert/strict'
import {leadDiscoverProjects,leadPreviewProject,leadConnectProject,teamConnectedModels,teamConnectedFile} from './projectConnectionApi.js'

const credentials={role:'team-a',apiHost:'cloud.getdbt.com',accountId:123,serviceToken:'test-token'}

test('dbt credentials use POST only without a separate Team Lead access code',async()=>{
  const calls=[]
  const fake=async(url,options)=>{
    calls.push({url,options})
    return {ok:true,json:async()=>({ok:true,projects:[{id:17,name:'Equity'}],project:{id:17},connection:{role:'team-a'}})}
  }
  await leadDiscoverProjects(credentials,fake)
  await leadPreviewProject({...credentials,projectId:17},fake)
  await leadConnectProject({...credentials,projectId:17,environmentId:101},fake)
  assert.deepEqual(calls.map(x=>x.url),['/api/lead/dbt/projects','/api/lead/dbt/preview','/api/lead/dbt/connect'])
  for (const call of calls) {
    assert.equal(call.options.method,'POST')
    assert.equal(call.options.headers['X-Portal-Lead-Key'],undefined)
    assert.match(call.options.body,/test-token/)
    assert.doesNotMatch(call.url,/test-token/)
    assert.equal(call.options.cache,'no-store')
  }
  assert.equal(JSON.parse(calls[2].options.body).environmentId,101)
})

test('team members read model inventory without receiving dbt tokens or lead codes',async()=>{
  const calls=[]
  const fake=async(url,options)=>{
    calls.push({url,options})
    return {ok:true,json:async()=>({connection:null,sources:[],models:[],content:'select 1'})}
  }
  await teamConnectedModels('team-c',fake)
  await teamConnectedFile('team-c','models/staging/team_c/stg_team_c_positions.sql',fake)
  assert.equal(calls[0].url,'/api/team-models/connected?role=team-c')
  assert.match(calls[1].url,/models%2Fstaging%2Fteam_c/)
  assert.equal(calls[0].options.headers['X-Portal-Lead-Key'],undefined)
})
