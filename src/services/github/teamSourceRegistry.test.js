import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchTeamSourceModels } from './teamSourceRegistry.js'

test('only team-owned staging SQL sources are discovered',async()=>{
  const urls=[]
  const response=async url=>{
    urls.push(url)
    return {ok:true,json:async()=>[
      {name:'stg_team_a_positions.sql',type:'file'},
      {name:'README.md',type:'file'},
      {name:'stg_team_c_positions.sql',type:'dir'},
    ]}
  }
  assert.deepEqual(await fetchTeamSourceModels('team-a',response),['stg_team_a_positions'])
  assert.ok(urls[0].includes('models/staging/team_a'))
})

test('GitHub rate-limit falls back to CDN for source SQL files',async()=>{
  const fetchImpl=async url=>url.startsWith('https://api.github.com')
    ? {ok:false,status:429}
    : {ok:true,json:async()=>({files:[
      {name:'/models/staging/team_c/stg_team_c_positions.sql'},
      {name:'/models/staging/team_a/stg_team_a_positions.sql'},
    ]})}
  assert.deepEqual(await fetchTeamSourceModels('team-c',fetchImpl),['stg_team_c_positions'])
})
