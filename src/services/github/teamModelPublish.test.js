import test from 'node:test'
import assert from 'node:assert/strict'
import { publishTeamModelPR } from './teamModelPublish.js'

test('creates new Team A SQL + YAML on a feature branch and opens PR',async()=>{
  const calls=[]
  const fetchImpl=async (url,opts={})=>{
    calls.push({url,opts})
    if(url.includes('/contents/')&&(!opts.method||opts.method==='GET'))return {status:404,ok:false,json:async()=>({})}
    if(url.endsWith('/git/ref/heads/main'))return {ok:true,json:async()=>({object:{sha:'abc123'}})}
    if(url.endsWith('/pulls'))return {ok:true,json:async()=>({html_url:'https://github.com/example/pull/1',number:1})}
    return {ok:true,json:async()=>({})}
  }
  const result=await publishTeamModelPR({
    role:'team-a',semanticName:'equity_new',sourceModel:'team_a_new',sourceSql:'select 1 as position_id',
    yamlText:'version: 2',token:'test-token',fetchImpl,
  })
  assert.equal(result.number,1)
  assert.equal(result.files.length,2)
  assert.ok(result.files.includes('models/staging/team_a/team_a_new.sql'))
  assert.ok(result.files.includes('models/semantic_models/team_a/equity_new.yml'))
  assert.equal(calls.filter(c=>c.opts.method==='PUT').length,2)
  assert.ok(calls.every(c=>!c.url.includes('test-token')))
})

test('rejects existing YAML without opening PR or changing main',async()=>{
  const urls=[]
  const fetchImpl=async url=>{urls.push(url);return {ok:true,status:200,json:async()=>({})}}
  await assert.rejects(publishTeamModelPR({
    role:'team-c',semanticName:'already_exists',yamlText:'x',token:'token',fetchImpl,
  }),/already exists/)
  assert.equal(urls.length,1)
})

test('invalid roles and path traversal are rejected',async()=>{
  await assert.rejects(publishTeamModelPR({role:'cdo',semanticName:'valid',yamlText:'x',token:'token'}),/Unknown team role/)
  await assert.rejects(publishTeamModelPR({role:'team-a',semanticName:'../bad',yamlText:'x',token:'token'}),/Invalid semantic model name/)
})
