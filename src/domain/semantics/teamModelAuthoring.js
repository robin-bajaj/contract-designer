import yaml from 'js-yaml'
import { resolveContract } from './teamModelView.js'
import { teamFolder } from '../../services/github/teamSemanticRegistry.js'
import { DATA_TYPES, SIMPLE_AGGREGATIONS, isNumericType } from '../contracts/dbtOptions.js'

export const SQL_IDENTIFIER = /^[a-z][a-z0-9_]*$/
const pickName = item => typeof item === 'string' ? item : item.name
const nonblank = value => typeof value === 'string' && value.trim().length > 0

export function createEmptyTeamModel(role, sourceModel = '') {
  const team = teamFolder(role)
  return {
    sourceModel,
    sourceMode: 'new',
    sourceSql: '',
    semanticName: '',
    description: '',
    group: `lob_${team}`,
    contract: '',
    attributes: [],
    inheritedMetrics: [],
    columns: [],
    metrics: [],
    aggTimeDimension: '',
  }
}

export function availableContracts(registry) {
  return registry.filter(c => c?.name && Number.isSafeInteger(Number(c.version)))
    .map(c => ({ name: c.name, version: Number(c.version), key: `${c.name}@${c.version}` }))
}

export function chooseContract(draft, contractKey, registry) {
  if (!contractKey) return { ...draft, contract: '', attributes: [], inheritedMetrics: [], aggTimeDimension: '' }
  const selected = availableContracts(registry).find(c => c.key === contractKey)
  if (!selected) throw Error('Selected CDO contract was not found in the approved registry')
  const inherited = resolveContract(selected.name, selected.version, registry)
  if (inherited.error) throw Error(inherited.error)
  return {
    ...draft, contract: contractKey,
    attributes: inherited.attributes.map(a => ({ name: a.name, selected: false, alias: '', semanticType: 'none', entityType: 'primary', granularity: 'day' })),
    inheritedMetrics: inherited.metrics.map(m => ({ name: m.name, selected: false, alias: '' })),
    aggTimeDimension: '',
  }
}

export function validateTeamDraft(draft, role, registry, availableSourceModels) {
  const errors = []
  try { teamFolder(role) } catch { errors.push('Unknown team role') }
  if (!SQL_IDENTIFIER.test(draft.sourceModel || '')) errors.push('Source dbt model name must be a lowercase SQL identifier.')
  if (!['new','existing'].includes(draft.sourceMode)) errors.push('Choose an existing or new SQL source model.')
  if (draft.sourceMode === 'existing' && !availableSourceModels.includes(draft.sourceModel)) errors.push('Select an existing team SQL source model.')
  if (draft.sourceMode === 'new' && availableSourceModels.includes(draft.sourceModel)) errors.push('This SQL source model already exists. Choose a new name or use existing source mode.')
  if (draft.sourceMode === 'new' && !nonblank(draft.sourceSql)) errors.push('Provide SQL for the new dbt source model.')
  if (!SQL_IDENTIFIER.test(draft.semanticName || '')) errors.push('Semantic model name must use lowercase letters, digits and underscores.')
  if (!nonblank(draft.description)) errors.push('Provide a semantic model description.')
  const owned = draft.columns || []
  const metrics = draft.metrics || []
  if (new Set(owned.map(c => c.name)).size !== owned.length) errors.push('Duplicate team-owned columns.')
  if (new Set(metrics.map(c => c.name)).size !== metrics.length) errors.push('Duplicate team-owned metrics.')
  for (const column of owned) {
    if (!SQL_IDENTIFIER.test(column.name || '')) errors.push(`Invalid team column name: ${column.name}`)
    if (!DATA_TYPES.includes(column.data_type)) errors.push(`Unsupported SQL type for ${column.name}`)
  }
  const selectedAttrs = (draft.attributes || []).filter(x => x.selected)
  const selectedMetrics = (draft.inheritedMetrics || []).filter(x => x.selected)
  const inheritedNames = selectedAttrs.map(x => x.name)
  for (const col of owned) if (inheritedNames.includes(col.name)) errors.push(`Team-owned column conflicts with inherited ${col.name}`)
  const availableExpressions = [...owned, ...selectedAttrs.map(x => ({ name:x.name, data_type:null }))]
  for (const metric of metrics) {
    if (!SQL_IDENTIFIER.test(metric.name || '')) errors.push(`Invalid team metric name: ${metric.name}`)
    if (!SIMPLE_AGGREGATIONS.includes(metric.agg)) errors.push(`Unsupported aggregation for ${metric.name}`)
    if (!availableExpressions.some(x=>x.name===metric.expr)) errors.push(`Metric ${metric.name} must reference a selected inherited or team column`)
    const field=owned.find(c=>c.name===metric.expr)
    if (field && ['sum','average','median'].includes(metric.agg) && !isNumericType(field.data_type)) errors.push(`Metric ${metric.name} requires a numeric source column`)
  }
  const names = [...metrics.map(m=>m.name), ...selectedMetrics.map(m=>m.alias || m.name)]
  if (new Set(names).size !== names.length) errors.push('Team and inherited metric names must be unique.')
  for (const a of selectedAttrs) {
    if (a.alias && !SQL_IDENTIFIER.test(a.alias)) errors.push(`Invalid alias for ${a.name}`)
    if (!['none','primary','foreign','time','categorical'].includes(a.semanticType)) errors.push(`Invalid semantic type for ${a.name}`)
    if (a.semanticType === 'time' && !['day','week','month','quarter','year'].includes(a.granularity)) errors.push(`Invalid time granularity for ${a.name}`)
  }
  for (const m of selectedMetrics) if (m.alias && !SQL_IDENTIFIER.test(m.alias)) errors.push(`Invalid metric alias for ${m.name}`)
  if (draft.aggTimeDimension && !selectedAttrs.some(a=>a.name===draft.aggTimeDimension && a.semanticType==='time'))
    errors.push('Aggregation time dimension must be an inherited attribute configured as time.')
  if (draft.contract) {
    const contract=availableContracts(registry).find(c=>c.key===draft.contract)
    if (!contract) errors.push('Selected CDO contract does not exist')
    else {
      const resolved=resolveContract(contract.name, contract.version, registry)
      if (resolved.error) errors.push(resolved.error)
      else {
        if (selectedAttrs.some(a=>!resolved.attributes.some(x=>x.name===a.name))) errors.push('Unknown inherited attribute')
        if (selectedMetrics.some(m=>!resolved.metrics.some(x=>x.name===m.name))) errors.push('Unknown inherited metric')
      }
    }
  } else if (selectedAttrs.length || selectedMetrics.length) errors.push('Cannot inherit definitions without a CDO contract.')
  return errors
}

export function buildTeamModelDocument(draft, role, registry, availableSourceModels) {
  const errors=validateTeamDraft(draft,role,registry,availableSourceModels)
  if (errors.length) throw Error(errors.join('\n'))
  const selectedAttrs=draft.attributes.filter(a=>a.selected)
  const selectedMetrics=draft.inheritedMetrics.filter(m=>m.selected)
  const model={
    name:draft.sourceModel,
    description:draft.description.trim(),
    config:{
      group:draft.group,
      access:'protected',
      contract:{enforced:true},
    },
    semantic_model:{enabled:true,name:draft.semanticName},
  }
  if (draft.contract) {
    const ref=availableContracts(registry).find(c=>c.key===draft.contract)
    model.config.meta={
      uses:{name:ref.name,version:ref.version},
      include:{
        attributes:selectedAttrs.map(a=>{
          const o={name:a.name}
          if (a.alias) o.alias=a.alias
          if (a.semanticType==='primary'||a.semanticType==='foreign') o.entity={type:a.semanticType}
          if (a.semanticType==='time') {o.dimension={type:'time'};o.granularity=a.granularity}
          if (a.semanticType==='categorical') o.dimension={type:'categorical'}
          return o
        }),
        metrics:selectedMetrics.map(m=>({name:m.name,...(m.alias?{alias:m.alias}:{})})),
      },
    }
  }
  if (draft.aggTimeDimension) model.agg_time_dimension=draft.aggTimeDimension
  model.columns=draft.columns.map(c=>({name:c.name,data_type:c.data_type,...(c.description?{description:c.description}:{})}))
  model.metrics=draft.metrics.map(m=>({
    name:m.name,type:'simple',agg:m.agg,expr:m.expr,
    ...(m.description?{description:m.description}:{}),
  }))
  return {version:2,models:[model]}
}

export function teamSourcePath(role, sourceModel) {
  if (!SQL_IDENTIFIER.test(sourceModel || '')) throw Error('Invalid SQL source model name')
  return `models/staging/${teamFolder(role)}/${sourceModel}.sql`
}

export function teamModelPath(role, semanticName) {
  if (!SQL_IDENTIFIER.test(semanticName || '')) throw Error('Invalid semantic model name')
  return `models/semantic_models/${teamFolder(role)}/${semanticName}.yml`
}

export function toTeamModelYaml(document) {
  return yaml.dump(document,{noRefs:true,sortKeys:false,lineWidth:110})
}
