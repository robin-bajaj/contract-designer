import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchTeamSemanticModels, parseTeamSemanticFile, teamFolder } from './teamSemanticRegistry.js'

const authored = `version: 2
models:
  - name: stg_team_a_positions
    config:
      meta:
        uses: {name: cdo.position, version: 1}
        include:
          attributes:
            - {name: position_id, alias: equity_position_id}
          metrics:
            - {name: total_profit_loss, alias: equity_profit_loss}
    semantic_model: {enabled: true, name: team_a_equity_positions}
    columns:
      - {name: mtm, data_type: numeric}
    metrics:
      - {name: equity_total_mtm, type: simple, agg: sum, expr: mtm}
  - name: unrelated_dbt_model
    columns: []
`

test('only Team A/C roles can address their separate source folders', () => {
  assert.equal(teamFolder('team-a'), 'team_a')
  assert.equal(teamFolder('team-c'), 'team_c')
  assert.throws(() => teamFolder('cdo'), /Unknown team role/)
})

test('parses team semantic models with authored inheritance and owned definitions', () => {
  const models = parseTeamSemanticFile(authored, 'models/semantic_models/team_a/team_a_semantics.yml', 'team-a')
  assert.equal(models.length, 1)
  assert.equal(models[0].semantic_model.name, 'team_a_equity_positions')
  assert.equal(models[0].config.meta.uses.version, 1)
  assert.equal(models[0].columns[0].name, 'mtm')
})

test('discovers all model YAMLs in the team folder; excludes other teams', async () => {
  const urls = []
  const fetchImpl = async url => {
    urls.push(url)
    if (url.includes('/contents/')) return { ok:true, json:async()=>[
      {name:'team_a_semantics.yml',type:'file'},
      {name:'second.yaml',type:'file'},
      {name:'note.txt',type:'file'},
      {name:'team_c_semantics.yml',type:'dir'},
    ] }
    return {ok:true,text:async()=>authored}
  }
  const result = await fetchTeamSemanticModels('team-a', fetchImpl)
  assert.equal(result.length, 2)
  assert.ok(urls.every(url => !url.includes('/team_c/')))
  assert.ok(urls.every(url => !url.includes('generated/production')))
})

test('falls back to CDN on GitHub listing rate limit', async () => {
  const urls = []
  const fetchImpl = async url => {
    urls.push(url)
    if (url.includes('api.github.com')) return {ok:false,status:429}
    if (url.includes('data.jsdelivr.com')) return {ok:true,json:async()=>({files:[
      {name:'/models/semantic_models/team_c/team_c_semantics.yml'},
      {name:'/models/semantic_models/team_a/team_a_semantics.yml'},
      {name:'/models/semantic_models/team_c/nested/ignore.yml'},
    ]})}
    return {ok:true,text:async()=>authored}
  }
  assert.equal((await fetchTeamSemanticModels('team-c',fetchImpl)).length,1)
  assert.ok(urls.some(url=>url.includes('data.jsdelivr.com')))
})

test('failed fetch does not invent team models', async () => {
  await assert.rejects(fetchTeamSemanticModels('team-a',async()=>({ok:false,status:500})), /HTTP 500/)
})
