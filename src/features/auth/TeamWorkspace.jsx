import React, { useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, Database, GitBranch, Plus, RefreshCw } from 'lucide-react'
import { ROLE_OPTIONS } from './roles.js'
import { parseTeamSemanticFile } from '../../services/github/teamSemanticRegistry.js'
import { listPortalModels, listPortalSources, dbtBackendStatus } from '../../services/portal/teamPortalApi.js'
import { fetchGovernanceContracts } from '../../services/github/githubRegistry.js'
import TeamModelEditor from './TeamModelEditor.jsx'
import { describeTeamSemanticModel } from '../../domain/semantics/teamModelView.js'
import './TeamWorkspace.css'

const identifier = value => value || '—'
const semanticDetails = item => [
  item.alias ? `alias: ${item.alias}` : null,
  item.entity ? `entity: ${item.entity.name || item.alias || item.name} (${item.entity.type || 'unspecified'})` : null,
  item.dimension ? `dimension: ${item.dimension.type || 'unspecified'}` : null,
  item.granularity ? `granularity: ${item.granularity}` : null,
].filter(Boolean).join(' · ')

function DefinitionTable({ headings, rows, renderRows, empty }) {
  return <div className="team-table-wrap">
    <table className="team-def-table"><thead><tr>{headings.map(h => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>{rows.length ? rows.map(renderRows) : <tr><td colSpan={headings.length} className="team-empty-cell">{empty}</td></tr>}</tbody>
    </table>
  </div>
}

function ModelDetails({ model }) {
  return <div className="team-model-details">
    <div className="team-model-heading">
      <div><span className="team-label">dbt semantic model</span><h2>{model.semanticName}</h2><p>{model.description || model.modelName}</p></div>
      <span className={`team-status ${model.dbtContractEnforced ? 'yes' : 'muted-status'}`}>
        {model.dbtContractEnforced ? <CheckCircle2 size={15}/> : <AlertCircle size={15}/>}
        dbt contract {model.dbtContractEnforced ? 'enforced' : 'not enforced'}
      </span>
    </div>
    <div className="team-meta-grid">
      <div><span>Source model</span><strong>{model.modelName}</strong></div>
      <div><span>dbt group</span><strong>{identifier(model.group)}</strong></div>
      <div><span>Model access</span><strong>{identifier(model.access)}</strong></div>
      <div><span>Aggregation time</span><strong>{identifier(model.aggTimeDimension)}</strong></div>
    </div>
    <div className="team-contract-reference">
      <GitBranch size={21}/>
      <div><span>CDO Contract Implemented</span>
        <strong>{model.contractRef ? `${model.contractRef.name} · v${model.contractRef.version}` : 'No CDO contract declared'}</strong>
        <small>{model.contractRef ? 'Reference in config.meta.uses · Compiled by the CDO semantic compiler' : 'Independent team model: no CDO inheritance declared'}</small>
      </div>
    </div>
    {model.contractError && <p className="team-error"><AlertCircle size={17}/>{model.contractError}</p>}
    <section className="team-detail-section">
      <h3>Inherited CDO attributes <span>{model.inheritedAttributes.length}</span></h3>
      <p>Canonical data types and descriptions come from the approved, version-pinned CDO contract. Team-specific entity and dimension annotations are displayed alongside them.</p>
      <DefinitionTable headings={['Canonical attribute', 'CDO data type', 'Team semantic mapping', 'CDO description']}
        rows={model.inheritedAttributes} empty="No inherited CDO attributes declared"
        renderRows={(field,i) => <tr key={`${field.name}-${i}`}>
          <td><strong>{field.name}</strong>{field.missing && <small className="team-warning">Not found in referenced contract</small>}</td>
          <td>{identifier(field.canonical?.data_type)}</td>
          <td>{semanticDetails(field) || 'Canonical name'}</td>
          <td>{identifier(field.canonical?.description)}</td>
        </tr>}/>
    </section>
    <section className="team-detail-section">
      <h3>Inherited CDO metrics <span>{model.inheritedMetrics.length}</span></h3>
      <p>CDO owns the metric definition; the team can expose an alias or label in its authored YAML.</p>
      <DefinitionTable headings={['CDO metric', 'Team-facing name', 'CDO definition', 'CDO description']}
        rows={model.inheritedMetrics} empty="No inherited CDO metrics declared"
        renderRows={(metric,i) => <tr key={`${metric.name}-${i}`}>
          <td><strong>{metric.name}</strong>{metric.missing && <small className="team-warning">Not found in referenced contract</small>}</td>
          <td>{metric.alias || metric.name}{metric.label && <small>{metric.label}</small>}</td>
          <td>{metric.canonical ? `${metric.canonical.agg || ''}(${metric.canonical.expr || ''})` : '—'}</td>
          <td>{identifier(metric.canonical?.description)}</td>
        </tr>}/>
    </section>
    <section className="team-detail-section">
      <h3>Team-owned columns <span>{model.teamColumns.length}</span></h3>
      <p>Columns explicitly defined by this team in its authored dbt YAML, not inherited from CDO.</p>
      <DefinitionTable headings={['Column', 'Data type', 'Description']} rows={model.teamColumns}
        empty="No team-owned columns declared"
        renderRows={(column,i) => <tr key={`${column.name}-${i}`}><td><strong>{column.name}</strong></td><td>{identifier(column.data_type)}</td><td>{identifier(column.description)}</td></tr>}/>
    </section>
    <section className="team-detail-section">
      <h3>Team-owned metrics <span>{model.teamMetrics.length}</span></h3>
      <p>Metrics defined by the team, separate from CDO-inherited metrics.</p>
      <DefinitionTable headings={['Metric', 'Type / aggregation', 'Expression', 'Description']} rows={model.teamMetrics}
        empty="No team-owned metrics declared"
        renderRows={(metric,i) => <tr key={`${metric.name}-${i}`}><td><strong>{metric.name}</strong>{metric.label && <small>{metric.label}</small>}</td><td>{identifier(metric.type)} / {identifier(metric.agg)}</td><td>{identifier(metric.expr)}</td><td>{identifier(metric.description)}</td></tr>}/>
    </section>
    <p className="team-demo-note">Authored model is stored in the portal; its compiled native YAML is published only after dbt Core validation.</p>
  </div>
}

export default function TeamWorkspace({ role }) {
  const workspace = ROLE_OPTIONS.find(option => option.id === role)
  const [models, setModels] = useState([])
  const [contracts, setContracts] = useState([])
  const [sourceModels,setSourceModels] = useState([])
  const [creating,setCreating] = useState(false)
  const [editing,setEditing] = useState(null)
  const [dbtStatus,setDbtStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    setModels([])
    setContracts([])
    setSourceModels([])
    Promise.all([listPortalModels(role), fetchGovernanceContracts(), listPortalSources(role), dbtBackendStatus()])
      .then(([teamModels, approvedContracts, ownedSql, status]) => {
        if (!active) return
        setModels(teamModels)
        setContracts(approvedContracts)
        setSourceModels(ownedSql)
        setDbtStatus(status)
        setSelectedId(current => teamModels.some(item => item.id === current) ? current : teamModels[0]?.id || null)
      })
      .catch(err => { if (active) setError(err.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [role, generation])

  const presentations = useMemo(() => models.flatMap(draft => {
    if (!draft.yamlText?.trim()) return []
    try {
      const parsed=parseTeamSemanticFile(draft.yamlText, `${draft.semanticName}.yml`, role)[0]
      return parsed ? [describeTeamSemanticModel({...parsed,id:draft.id}, contracts)] : []
    } catch { return [] }
  }), [models, contracts, role])
  const currentModel = presentations.find(model => model.id === selectedId) || presentations[0]

  if (creating) return <div className="team-page"><TeamModelEditor key={editing?.id||'new'} role={role} contracts={contracts}
    sourceModels={sourceModels} initialDraft={editing}
    onBack={()=>{setCreating(false);setEditing(null);setGeneration(value=>value+1)}}/></div>

  return <div className="team-page">
    <main className="team-dashboard">
      <div className="team-dashboard-title">
        <div><span className="team-label">PORTAL-OWNED SEMANTIC MODELS</span><h1>{workspace?.label} Workspace</h1>
          <p>{workspace?.description} · Create staging and semantic models here, validate with dbt Core, then publish to a configured dbt project.</p></div>
        <div className="team-dashboard-actions"><button type="button" className="primary team-create-button" disabled={loading||Boolean(error)} onClick={()=>{setEditing(null);setCreating(true)}}><Plus size={15}/> Create Semantic Model</button>
        <button type="button" className="outline" disabled={loading} onClick={() => setGeneration(v => v + 1)}>
          <RefreshCw size={15}/>{loading ? 'Loading...' : 'Refresh portal drafts'}
        </button></div>
      </div>
      <div className="team-repository-line"><Database size={17}/><span>Source: <strong>Python portal backend</strong> · dbt Core: {dbtStatus?.dbtCoreAvailable?'installed':'not detected'} · dbt project: {dbtStatus?.localProjectConfigured?'configured':'not configured'} · CDO contracts: approved registry</span></div>
      {loading && <div className="team-loading" role="status">Loading portal drafts and approved CDO contracts…</div>}
      {error && <div className="team-error" role="alert"><AlertCircle size={18}/>Unable to load portal models or CDO registry: {error}. <button onClick={() => setGeneration(v => v + 1)}>Retry</button></div>}
      {!loading && !error && !presentations.length && <div className="team-empty">No portal-authored models yet. Create a staging and semantic model to get started.</div>}
      {!loading && !error && models.length > 0 && <section className="team-detail-section">
        <h3>Portal models and drafts <span>{models.length}</span></h3>
        <div className="team-draft-list">
          {models.map(draft=><div className="team-draft-row" key={draft.id}>
            <div><strong>{draft.semanticName||draft.sourceModel||'Untitled draft'}</strong>
              <small>{draft.status} · staging: {draft.sourceModel||'not set'}</small>
            </div>
            <button type="button" className="outline" onClick={()=>{setEditing(draft);setCreating(true)}}>Continue editing</button>
          </div>)}
        </div>
      </section>}
      {!loading && !error && currentModel && <>
        <div className="team-model-picker"><label htmlFor="team-model-select">Team semantic model</label>
          <select id="team-model-select" value={currentModel.id} onChange={e => setSelectedId(e.target.value)}>
            {presentations.map(model => <option key={model.id} value={model.id}>{model.semanticName} — {model.modelName}</option>)}
          </select>
          <span>{presentations.length} model{presentations.length===1?'':'s'} with semantic YAML</span>
        </div>
        <ModelDetails model={currentModel}/>
      </>}
      <p className="team-demo-note">Team drafts are local to our Python backend; they are not read from or synchronized with federated-semantic-poc. Publishing writes to DBT_PROJECT_PATH only after dbt Core validation. Role selection remains a prototype, not production authentication.</p>
    </main>
  </div>
}
