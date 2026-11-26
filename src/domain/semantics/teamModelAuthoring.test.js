import test from 'node:test'
import assert from 'node:assert/strict'
import { createEmptyTeamModel, chooseContract, validateTeamDraft, buildTeamModelDocument, teamModelPath, teamSourcePath, toTeamModelYaml } from './teamModelAuthoring.js'
import { initialContracts } from '../contracts/contractFixtures.test-data.js'

const sourceModels=['stg_team_a_positions']

const valid=()=>{
  let draft=createEmptyTeamModel('team-a')
  draft.sourceModel='team_a_custom_positions'
  draft.sourceSql="select position_id, report_date, profit_loss, instrument_code from {{ ref('stg_team_a_positions') }}"
  draft.semanticName='team_a_custom_equity'
  draft.description='Custom equity positions'
  draft=chooseContract(draft,'cdo.position@1',initialContracts)
  draft.attributes=draft.attributes.map(a=>({...a,selected:true,semanticType:a.name==='report_date'?'time':a.name==='position_id'?'primary':'none'}))
  draft.inheritedMetrics=draft.inheritedMetrics.map(m=>({...m,selected:true,alias:'equity_custom_profit_loss'}))
  draft.aggTimeDimension='report_date'
  draft.columns=[{name:'mtm',data_type:'numeric',description:'Mark to market'}]
  draft.metrics=[{name:'equity_custom_mtm',agg:'sum',expr:'mtm',description:'Custom total MTM'}]
  return draft
}

test('create Team A source SQL and dbt semantic YAML with CDO inheritance',()=>{
  const draft=valid()
  assert.deepEqual(validateTeamDraft(draft,'team-a',initialContracts,sourceModels),[])
  const doc=buildTeamModelDocument(draft,'team-a',initialContracts,sourceModels)
  const model=doc.models[0]
  assert.equal(doc.version,2)
  assert.equal(model.name,'team_a_custom_positions')
  assert.equal(model.semantic_model.name,'team_a_custom_equity')
  assert.deepEqual(model.config.meta.uses,{name:'cdo.position',version:1})
  assert.equal(model.config.contract.enforced,true)
  assert.equal(model.config.meta.include.attributes.find(a=>a.name==='report_date').dimension.type,'time')
  assert.equal(model.config.meta.include.metrics[0].alias,'equity_custom_profit_loss')
  assert.deepEqual(model.columns.map(x=>x.name),['mtm'])
  assert.equal(model.metrics[0].expr,'mtm')
  assert.match(toTeamModelYaml(doc),/semantic_model:/)
})

test('Team C proposal targets only Team C SQL and YAML paths',()=>{
  assert.equal(teamModelPath('team-c','fi_new'),'models/semantic_models/team_c/fi_new.yml')
  assert.equal(teamSourcePath('team-c','fi_source'),'models/staging/team_c/fi_source.sql')
  assert.throws(()=>teamModelPath('team-a','../invalid'),/Invalid/)
  assert.throws(()=>teamSourcePath('cdo','valid_name'),/Unknown team role/)
})

test('missing physical SQL source fails local validation',()=>{
  const draft=valid()
  draft.sourceSql=''
  assert.match(validateTeamDraft(draft,'team-a',initialContracts,sourceModels).join(' '),/Provide SQL/)
})

test('inherited metrics cannot be selected without required inherited source attribute',()=>{
  const draft=valid()
  draft.attributes=draft.attributes.map(a=>a.name==='profit_loss'?{...a,selected:false}:a)
  assert.match(validateTeamDraft(draft,'team-a',initialContracts,sourceModels).join(' '),/requires selected attribute profit_loss/)
})

test('team-owned columns cannot redefine selected inherited contract columns',()=>{
  const draft=valid()
  draft.columns.push({name:'position_id',data_type:'text'})
  assert.match(validateTeamDraft(draft,'team-a',initialContracts,sourceModels).join(' '),/conflicts/)
})

test('existing SQL source mode only accepts verified team source models',()=>{
  const draft=valid()
  draft.sourceMode='existing'
  draft.sourceModel='stg_team_a_positions'
  assert.deepEqual(validateTeamDraft(draft,'team-a',initialContracts,sourceModels),[])
  assert.ok(!buildTeamModelDocument(draft,'team-a',initialContracts,sourceModels).models[0].sourceSql)
})

test('independent semantic model can be authored with team-owned columns and metrics',()=>{
  const draft=createEmptyTeamModel('team-c')
  draft.sourceModel='team_c_custom'
  draft.sourceSql='select 1::integer as num'
  draft.semanticName='fi_custom'
  draft.description='Independent FI model'
  draft.columns=[{name:'num',data_type:'integer',description:'',semanticType:'primary'}]
  draft.metrics=[{name:'fi_count',agg:'count',expr:'num',description:''}]
  assert.deepEqual(validateTeamDraft(draft,'team-c',initialContracts,[]),[])
  const doc=buildTeamModelDocument(draft,'team-c',initialContracts,[])
  assert.ok(!doc.models[0].config.meta)
  assert.deepEqual(doc.models[0].columns[0].entity,{type:'primary'})
})
