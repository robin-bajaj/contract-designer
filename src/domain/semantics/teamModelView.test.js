import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveContract, describeTeamSemanticModel } from './teamModelView.js'

const registry = [
  {name:'cdo.all',version:1,attributes:[
    {name:'position_id',data_type:'text',description:'Position identifier'},
    {name:'profit_loss',data_type:'numeric',description:'Standardized profit and loss'},
  ],metrics:[{name:'total_profit_loss',agg:'sum',expr:'profit_loss'}]},
  {name:'cdo.all',version:2,attributes:[{name:'position_id',data_type:'integer'}],metrics:[]},
  {name:'cdo.position',version:1,uses:{name:'cdo.all',version:1},
    include:{attributes:['position_id','profit_loss'],metrics:['total_profit_loss']},attributes:[],metrics:[]},
]
const model = {
  id:'team-a-model',name:'stg_team_a_positions',sourcePath:'models/semantic_models/team_a/team_a_semantics.yml',
  semantic_model:{name:'team_a_equity_positions'},
  config:{group:'lob_team_a',contract:{enforced:true},meta:{
    uses:{name:'cdo.position',version:1},
    include:{attributes:[{name:'position_id',alias:'equity_position_id',entity:{type:'primary'}}],
      metrics:[{name:'total_profit_loss',alias:'equity_profit_loss'}]},
  }},
  columns:[{name:'mtm',data_type:'numeric'}],
  metrics:[{name:'equity_total_mtm',agg:'sum',expr:'mtm'}],
}

test('resolves the pinned CDO v1 definition instead of newer v2', () => {
  const resolved = resolveContract('cdo.position',1,registry)
  assert.equal(resolved.error,undefined)
  assert.equal(resolved.attributes[0].data_type,'text')
  assert.equal(resolved.metrics[0].expr,'profit_loss')
})

test('keeps adopted definitions separate from team-owned fields', () => {
  const view = describeTeamSemanticModel(model,registry)
  assert.equal(view.contractRef.version,1)
  assert.equal(view.inheritedAttributes[0].canonical.data_type,'text')
  assert.equal(view.inheritedAttributes[0].alias,'equity_position_id')
  assert.equal(view.inheritedMetrics[0].alias,'equity_profit_loss')
  assert.deepEqual(view.teamColumns.map(c=>c.name),['mtm'])
  assert.deepEqual(view.teamMetrics.map(m=>m.name),['equity_total_mtm'])
  assert.equal(view.dbtContractEnforced,true)
})

test('missing references and absent attributes show explicit failure instead of guessing', () => {
  const missing = describeTeamSemanticModel({...model,config:{meta:{
    uses:{name:'cdo.position',version:8},include:{attributes:[{name:'missing'}],metrics:[]},
  }}},registry)
  assert.match(missing.contractError,/missing/)
  assert.equal(missing.inheritedAttributes[0].missing,true)
})

test('independent team semantic model works without CDO inheritance', () => {
  const independent = describeTeamSemanticModel({
    id:'other',name:'other',columns:[{name:'team_column',data_type:'text'}],metrics:[],
  },registry)
  assert.equal(independent.contractRef,null)
  assert.equal(independent.inheritedAttributes.length,0)
  assert.equal(independent.teamColumns.length,1)
})

test('cycles do not hang contract inheritance resolver', () => {
  const cycles=[{name:'a',version:1,uses:{name:'b',version:1},include:{attributes:[],metrics:[]}},
    {name:'b',version:1,uses:{name:'a',version:1},include:{attributes:[],metrics:[]}}]
  assert.match(resolveContract('a',1,cycles).error,/Circular/)
})
