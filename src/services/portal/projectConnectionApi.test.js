import test from 'node:test'
import assert from 'node:assert/strict'
import {adminProjects,adminProjectPreview,adminAssignProject,teamConnectedModels,teamConnectedFile} from './projectConnectionApi.js'

test('administrator authorization key is sent only to the protected backend',async()=>{
  let path,headers
  const fake=async(u,o)=>{
    path=u;headers=o.headers
    return {ok:true,json:async()=>({projects:[{id:17,name:'Equity'}],connections:[]})}
  }
  const result=await adminProjects('session-only-admin-key',fake)
  assert.equal(path,'/api/admin/project-connections/projects')
  assert.equal(headers['X-Portal-Admin-Key'],'session-only-admin-key')
  assert.equal(result.projects[0].name,'Equity')
})
test('project selection and assignment have no database credentials in payload',async()=>{
  const calls=[]
  const fake=async(url,options)=>{
    calls.push({url,options})
    return {ok:true,json:async()=>({project:{id:17,environments:[{id:101}]},connection:{role:'team-a'}})}
  }
  await adminProjectPreview('key',17,fake)
  await adminAssignProject('key','team-a',17,101,fake)
  assert.match(calls[0].url,/projectId=17/)
  assert.equal(calls[1].options.method,'POST')
  assert.deepEqual(JSON.parse(calls[1].options.body),{role:'team-a',projectId:17,environmentId:101})
  assert.doesNotMatch(calls[1].options.body,/password|token|host/)
})
test('developer metadata calls require no dbt/GitHub/admin secrets',async()=>{
  const seen=[]
  const fake=async(u,o)=>{
    seen.push([u,o])
    return {ok:true,json:async()=>({connection:null,sources:[],models:[],content:'select 1'})}
  }
  await teamConnectedModels('team-c',fake)
  await teamConnectedFile('team-c','models/staging/team_c/stg_team_c_positions.sql',fake)
  assert.equal(seen[0][0],'/api/team-models/connected?role=team-c')
  assert.match(seen[1][0],/models%2Fstaging%2Fteam_c/)
  assert.equal(seen[0][1].headers['X-Portal-Admin-Key'],undefined)
  assert.equal(seen[1][1].headers['X-Portal-Admin-Key'],undefined)
})
