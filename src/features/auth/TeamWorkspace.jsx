import React, { useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, Database, GitBranch, Plus, RefreshCw } from 'lucide-react'
import { ROLE_OPTIONS } from './roles.js'
import { parseTeamSemanticFile } from '../../services/github/teamSemanticRegistry.js'
import { listPortalModels, listPortalSources, deletePortalDraft, dbtBackendStatus } from '../../services/portal/teamPortalApi.js'
import { teamConnectedModels, teamConnectedFile } from '../../services/portal/projectConnectionApi.js'
import { fetchGovernanceContracts } from '../../services/github/githubRegistry.js'
import TeamModelEditor from './TeamModelEditor.jsx'
import ProjectFileTree from './ProjectFileTree.jsx'
import ProjectConnectionsAdmin from './ProjectConnectionsAdmin.jsx'
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
      <div><span className="team-label">Semantic model</span><h2>{model.semanticName}</h2><p>{model.description || model.modelName}</p></div>
      <span className={`team-status ${model.dbtContractEnforced ? 'yes' : 'muted-status'}`}>
        {model.dbtContractEnforced ? <CheckCircle2 size={15}/> : <AlertCircle size={15}/>}
        Model contract {model.dbtContractEnforced ? 'enforced' : 'not enforced'}
      </span>
    </div>
    <div className="team-meta-grid">
      <div><span>Source model</span><strong>{model.modelName}</strong></div>
      <div><span>Team group</span><strong>{identifier(model.group)}</strong></div>
      <div><span>Model access</span><strong>{identifier(model.access)}</strong></div>
      <div><span>Aggregation time</span><strong>{identifier(model.aggTimeDimension)}</strong></div>
    </div>
    <div className="team-contract-reference">
      <GitBranch size={21}/>
      <div><span>CDO Contract Implemented</span>
        <strong>{model.contractRef ? `${model.contractRef.name} · v${model.contractRef.version}` : 'No CDO contract declared'}</strong>
        <small>{model.contractRef ? 'Definitions inherited from the approved contract version' : 'Independent team model: no CDO inheritance declared'}</small>
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
      <p>Columns defined by this team, not inherited from CDO.</p>
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
    <p className="team-demo-note">Model definitions are stored in the portal and published after validation.</p>
  </div>
}

export default function TeamWorkspace({ role }) {
  const workspace = ROLE_OPTIONS.find(option => option.id === role)
  const [models, setModels] = useState([])
  const [contracts, setContracts] = useState([])
  const [sourceModels,setSourceModels] = useState([])
  const [creating,setCreating] = useState(false)
  const [connecting,setConnecting] = useState(false)
  const [editing,setEditing] = useState(null)
  const [dbtStatus,setDbtStatus] = useState(null)
  const [connectedCatalog,setConnectedCatalog] = useState(null)
  const [catalogLoading,setCatalogLoading] = useState(true)
  const [catalogError,setCatalogError] = useState('')
  const [openedFile,setOpenedFile] = useState(null)
  const [openedFileError,setOpenedFileError] = useState('')
  const [openedFileLoading,setOpenedFileLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [generation, setGeneration] = useState(0)
  const [draftActionError, setDraftActionError] = useState('')

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

  useEffect(() => {
    let active=true
    setConnectedCatalog(null);setCatalogError('');setOpenedFile(null)
    setCatalogLoading(true)
    teamConnectedModels(role)
      .then(catalog=>{if(active)setConnectedCatalog(catalog)})
      .catch(err=>{if(active)setCatalogError(err.message)})
      .finally(()=>{if(active)setCatalogLoading(false)})
    return ()=>{active=false}
  },[role,generation])

  const openConnectedFile=async path=>{
    setOpenedFile(null);setOpenedFileError('');setOpenedFileLoading(true)
    try{
      const file=await teamConnectedFile(role,path)
      setOpenedFile(file)
    }catch(err){setOpenedFileError(err.message)}
    finally{setOpenedFileLoading(false)}
  }

  const removeDraft = async draft => {
    if (draft.status === 'published') return
    if (!window.confirm(`Delete unsaved portal draft "${draft.semanticName || draft.sourceModel || 'Untitled draft'}"? This will not delete files in GitHub.`)) return
    setDraftActionError('')
    try {
      await deletePortalDraft(draft.id, role)
      setGeneration(value => value + 1)
    } catch (err) { setDraftActionError(err.message) }
  }

  // Older running Python backends return sourceFiles/models but not files.
  // Use what was actually discovered, rather than displaying a blank explorer.
  const discoveredFiles = useMemo(() => {
    const catalog = connectedCatalog || {}
    return [...new Set([
      ...(Array.isArray(catalog.files) ? catalog.files : []),
      ...(Array.isArray(catalog.sourceFiles) ? catalog.sourceFiles.map(file => file.path) : []),
      ...(Array.isArray(catalog.models) ? catalog.models.map(model => model.file) : []),
    ].filter(Boolean))].sort()
  }, [connectedCatalog])

  const presentations = useMemo(() => models.flatMap(draft => {
    if (!draft.yamlText?.trim()) return []
    try {
      const parsed=parseTeamSemanticFile(draft.yamlText, `${draft.semanticName}.yml`, role)[0]
      return parsed ? [describeTeamSemanticModel({...parsed,id:draft.id}, contracts)] : []
    } catch { return [] }
  }), [models, contracts, role])
  const currentModel = presentations.find(model => model.id === selectedId) || presentations[0]

  if (connecting) return <ProjectConnectionsAdmin role={role}
    onBack={()=>{setConnecting(false);setGeneration(current=>current+1)}}/>

  if (creating) return <div className="team-page"><TeamModelEditor key={editing?.id||'new'} role={role} contracts={contracts}
    sourceModels={sourceModels} initialDraft={editing}
    onBack={()=>{setCreating(false);setEditing(null);setGeneration(value=>value+1)}}/></div>

  return <div className="team-page">
    <main className="team-dashboard">
      <div className="team-dashboard-title">
        <div><span className="team-label">PORTAL-OWNED SEMANTIC MODELS</span><h1>{workspace?.label} Workspace</h1>
          <p>{workspace?.description} · Create staging and semantic models, inherit CDO definitions, validate, and publish—all in one place.</p></div>
        <div className="team-dashboard-actions"><button type="button" className="outline" disabled={loading} onClick={()=>setConnecting(true)}><GitBranch size={15}/> Team Lead: Connect dbt Project</button>
        <button type="button" className="primary team-create-button" disabled={loading||Boolean(error)} onClick={()=>{setEditing(null);setCreating(true)}}><Plus size={15}/> Create Semantic Model</button>
        <button type="button" className="outline" disabled={loading} onClick={() => setGeneration(v => v + 1)}>
          <RefreshCw size={15}/>{loading ? 'Loading...' : 'Refresh models'}
        </button></div>
      </div>
      <div className="team-repository-line" role="status"><Database size={17}/><span><strong>{dbtStatus?.workspaceReady ? 'Model workspace ready' : 'Preparing model workspace'}</strong> · {dbtStatus?.validationReady ? 'Validation service available' : 'Validation service unavailable — contact the administrator'} · Approved CDO contracts available</span></div>
      <div className="dbt-studio-layout">
        <aside className="dbt-studio-sidebar" aria-label="dbt project files">
          <div className="dbt-sidebar-heading">
            <Database size={17}/>
            <div><strong>{connectedCatalog?.connection?.projectName || 'dbt project'}</strong><small>{connectedCatalog?.connection?.repository || 'Connect a dbt Cloud project'}</small></div>
            <button type="button" className="outline" title="Refresh project files" onClick={()=>setGeneration(v=>v+1)}><RefreshCw size={15}/></button>
          </div>
          {!catalogLoading && connectedCatalog?.connection && !Array.isArray(connectedCatalog.files) &&
            <p className="dbt-backend-warning">Your Python API is still running an older version. Restart <code>npm run dev:api</code> to discover the full repository. Showing the files already discovered.</p>}
          {connectedCatalog?.connection
            ? <ProjectFileTree paths={discoveredFiles} onOpen={openConnectedFile}
                onCreate={()=>{setEditing(null);setCreating(true)}}/>
            : <p className="dbt-backend-warning">Connect your project to browse files.</p>}
        </aside>
        <div className="dbt-studio-main">
      <section className="team-detail-section team-connected-project" aria-label="Connected dbt Cloud project inventory">
        <h3><GitBranch size={18}/> Connected dbt project</h3>
        {catalogLoading && <p role="status">Discovering models from the connected project…</p>}
        {catalogError && <p className="team-error" role="alert">Unable to discover the connected project: {catalogError}</p>}
        {!catalogLoading && !catalogError && !connectedCatalog?.connection && <p>No dbt Cloud project connected yet. Ask your CDO administrator to connect an existing project.</p>}
        {connectedCatalog?.connection && <>
          <div className="team-connected-summary">
            <div><span>dbt project</span><strong>{connectedCatalog.connection.projectName}</strong></div>
            <div><span>Environment</span><strong>{connectedCatalog.connection.environmentName}</strong></div>
            <div><span>Connected GitHub repository</span><strong>{connectedCatalog.connection.repository}</strong></div>
            <div><span>Discovered staging models</span><strong>{connectedCatalog.sources.length}</strong></div>
          </div>
          <p>Existing definitions are read from the connected repository. Database credentials stay in dbt Cloud. These previews are read-only; validation and remote editing integration will follow.</p>
          <p>Browse and open files in the left-hand dbt project explorer. Files are read-only until GitHub editing is connected.</p>
          <button type="button" className="primary team-create-button" onClick={()=>{setEditing(null);setCreating(true)}}><Plus size={15}/> Create model draft</button>
          {openedFileLoading && <p role="status">Opening file…</p>}
          {openedFileError && <p className="team-error" role="alert">{openedFileError}</p>}
          {openedFile && <div className="team-connected-file">
            <div><strong>{openedFile.path}</strong><button className="outline" onClick={()=>setOpenedFile(null)} type="button">Close file</button></div>
            <pre aria-label="Connected project source">{openedFile.content}</pre>
          </div>}
          <h4>Staging models</h4>
          {connectedCatalog.sources.length ? <div className="team-connected-source-list">
            {(connectedCatalog.sourceFiles||[]).map(file=><button type="button" key={file.path} className="team-connected-source" disabled={openedFileLoading} onClick={()=>openConnectedFile(file.path)} title="View source SQL">{file.name}</button>)}
          </div> : <p>No staging SQL files found in this team's model folder.</p>}
          <h4>Semantic models from Git</h4>
          {connectedCatalog.models.length ? <div className="team-connected-model-list">
            {connectedCatalog.models.map((model,index)=><div className="team-connected-model-row" key={model.file+'-'+index}>
              <div><strong>{model.semanticName||model.sourceModel||model.file}</strong>
                <small>{model.description||'No description'} · {model.sourceModel||'No source model'}{model.contract?.name ? ` · Inherits ${model.contract.name} v${model.contract.version}` : ''}</small></div>
              <button type="button" className="outline" disabled={openedFileLoading} onClick={()=>openConnectedFile(model.file)}>View source YAML</button>
            </div>)}
          </div> : <p>No semantic YAML definitions found in this team's model folder.</p>}
          {connectedCatalog.limited && <p>Showing the first 60 semantic YAML files. Ask the administrator to narrow the repository for larger projects.</p>}

        </>}
      </section>
      {loading && <div className="team-loading" role="status">Loading your models and approved contracts…</div>}
      {error && <div className="team-error" role="alert"><AlertCircle size={18}/>Unable to load your workspace: {error}. <button onClick={() => setGeneration(v => v + 1)}>Retry</button></div>}
      {!loading && !error && !models.length && <div className="team-empty">No portal-authored models yet. Create a staging and semantic model to get started.</div>}
      {!loading && !error && models.length > 0 && <section className="team-detail-section">
        <h3>Portal models and drafts <span>{models.length}</span></h3>
        {draftActionError && <p className="team-error" role="alert">{draftActionError}</p>}
        <div className="team-draft-list">
          {models.map(draft=><div className="team-draft-row" key={draft.id}>
            <div><strong>{draft.semanticName||draft.sourceModel||'Untitled draft'}</strong>
              <small>{draft.status} · staging: {draft.sourceModel||'not set'}</small>
            </div>
            <div className="team-dashboard-actions">
              <button type="button" className="outline" onClick={()=>{setEditing(draft);setCreating(true)}}>Continue editing</button>
              {draft.status !== 'published' && <button type="button" className="outline" onClick={()=>removeDraft(draft)}>Delete draft</button>}
            </div>
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
      <p className="team-demo-note">Your drafts and published definitions stay in this portal workspace. Remote deployment is not enabled yet. Role selection remains a development prototype.</p>
        </div>
      </div>
    </main>
  </div>
}
