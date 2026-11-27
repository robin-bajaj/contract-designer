import test from 'node:test'
import assert from 'node:assert/strict'
import { listPortalModels, listPortalSources, savePortalDraft, validatePortalDraft, publishPortalDraft } from './teamPortalApi.js'

test('team discovery calls our Python API and never reads federated-semantic-poc',async()=>{
  const seen=[]
  const fetchImpl=async url=>{
    seen.push(url)
    const data=url.includes('sources')?{sources:['stg_team_a_positions']}:{models:[{id:'abc',role:'team-a'}]}
    return {ok:true,json:async()=>data}
  }
  assert.equal((await listPortalModels('team-a',fetchImpl))[0].role,'team-a')
  assert.deepEqual(await listPortalSources('team-a',fetchImpl),['stg_team_a_positions'])
  assert.ok(seen.every(url=>url.startsWith('/api/team-models')))
  assert.ok(seen.every(url=>!url.includes('federated')))
})

test('save, validate and publish send only identifiers and draft data to Python API',async()=>{
  const requests=[]
  const fetchImpl=async(url,options)=>{
    requests.push({url,options})
    if(url.endsWith('/save')) return {ok:true,json:async()=>({draft:{id:'draft-1'}})}
    if(url.endsWith('/validate')) return {ok:true,json:async()=>({ok:true,steps:[]})}
    return {ok:true,json:async()=>({status:'published-local'})}
  }
  const data={role:'team-a',sourceModel:'new_stg',semanticName:'new_sem',
              sourceMode:'new',sourceSql:'select 1',yamlText:'version: 2',
              draftData:{description:'a draft'}}
  assert.equal((await savePortalDraft(data,fetchImpl)).id,'draft-1')
  assert.equal((await validatePortalDraft('draft-1',fetchImpl)).ok,true)
  assert.equal((await publishPortalDraft('draft-1',fetchImpl)).status,'published-local')
  assert.deepEqual(requests.map(r=>r.url),[
    '/api/team-models/save','/api/team-models/validate','/api/team-models/publish',
  ])
  assert.equal(JSON.parse(requests[2].options.body).id,'draft-1')
})

test('backend errors are surfaced to editor',async()=>{
  const broken=async()=>({ok:false,status:409,json:async()=>({error:'Validate this draft first'})})
  await assert.rejects(publishPortalDraft('id',broken),/Validate this draft first/)
})
