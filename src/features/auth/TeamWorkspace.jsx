import React, { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Database, FileCode2, FolderOpen, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { ROLE_OPTIONS } from './roles.js'
import { fetchGovernanceContracts } from '../../services/github/githubRegistry.js'
import { loadTeamDrafts, saveTeamDraft, deleteTeamDraft } from '../../services/local/teamDraftStore.js'
import { validateTeamDraft } from '../../domain/semantics/teamModelAuthoring.js'
import TeamModelEditor from './TeamModelEditor.jsx'
import './TeamWorkspace.css'

const findLocalSql = (drafts, editingId = null) =>
  [...new Set(drafts.filter(entry =>
    entry.id !== editingId && entry.draft.sourceMode === 'new' &&
    entry.draft.sourceSql?.trim(),
  ).map(entry => entry.draft.sourceModel).filter(Boolean))]

/**
 * Local prototype mode: CDO registry is the only connected source.
 * No reads, writes, or validation-clones of federated-semantic-poc.
 */
export default function TeamWorkspace({ role }) {
  const workspace = ROLE_OPTIONS.find(option => option.id === role)
  const [drafts, setDrafts] = useState(() => loadTeamDrafts(role))
  const [contracts, setContracts] = useState([])
  const [registryError, setRegistryError] = useState('')
  const [loading, setLoading] = useState(true)
  const [generation, setGeneration] = useState(0)
  const [editing, setEditing] = useState(null)
  const [isEditorOpen, setEditorOpen] = useState(false)
  const [storageError, setStorageError] = useState('')

  useEffect(() => {
    setDrafts(loadTeamDrafts(role))
    setEditing(null)
    setEditorOpen(false)
  }, [role])

  useEffect(() => {
    let active = true
    setLoading(true)
    setRegistryError('')
    fetchGovernanceContracts()
      .then(approved => { if (active) setContracts(approved) })
      .catch(error => { if (active) setRegistryError(error.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [generation])

  const openNew = () => { setEditing(null); setStorageError(''); setEditorOpen(true) }
  const openDraft = entry => { setEditing(entry); setStorageError(''); setEditorOpen(true) }
  const saveDraft = draft => {
    const saved = saveTeamDraft(role, draft)
    if (editing?.id && saved.id !== editing.id) deleteTeamDraft(role, editing.id)
    setDrafts(loadTeamDrafts(role))
    setEditing(saved)
    return saved
  }
  const removeDraft = entry => {
    try { setDrafts(deleteTeamDraft(role, entry.id)); setStorageError('') }
    catch (error) { setStorageError(error.message) }
  }

  if (isEditorOpen) return <div className="team-page">
    <TeamModelEditor
      key={editing?.id || 'new'}
      role={role}
      contracts={contracts}
      sourceModels={findLocalSql(drafts, editing?.id)}
      initialDraft={editing?.draft}
      onSave={saveDraft}
      onBack={() => { setDrafts(loadTeamDrafts(role)); setEditorOpen(false) }}
    />
  </div>

  return <div className="team-page">
    <main className="team-dashboard">
      <div className="team-dashboard-title">
        <div>
          <span className="team-label">LOCAL MODEL WORKSPACE</span>
          <h1>{workspace?.label} Workspace</h1>
          <p>Develop staging SQL and semantic models here. No federated dbt repository synchronization.</p>
        </div>
        <div className="team-dashboard-actions">
          <button type="button" className="primary team-create-button" onClick={openNew}><Plus size={15}/> Create Semantic Model</button>
          <button type="button" className="outline" disabled={loading} onClick={() => setGeneration(g => g + 1)}>
            <RefreshCw size={15}/>{loading ? 'Loading CDO…' : 'Refresh CDO Contracts'}
          </button>
        </div>
      </div>
      <div className="team-repository-line">
        <Database size={17}/>
        <span><strong>Local-only drafts</strong> · CDO contracts are read-only from the governance registry · No Team A/C GitHub discovery or publishing</span>
      </div>
      {registryError && <p className="team-error" role="alert"><AlertCircle size={17}/>Could not refresh CDO contracts: {registryError}. You can still create independent team drafts.</p>}
      {storageError && <p className="team-error" role="alert"><AlertCircle size={17}/>{storageError}</p>}
      {!drafts.length ? <div className="team-empty">
        <FolderOpen size={29}/>
        <h2>No local semantic models yet</h2>
        <p>Create staging SQL and a semantic model, then save a draft in this browser or download SQL/YAML files. Nothing is sent to federated-semantic-poc.</p>
        <button type="button" className="primary" onClick={openNew}><Plus size={15}/> Create your first model</button>
      </div> : <div className="team-local-list" aria-label="Saved team model drafts">
        {drafts.map(entry => {
          const draft = entry.draft
          const available = findLocalSql(drafts, entry.id)
          const issues = validateTeamDraft(draft, role, contracts, available)
          return <article className="team-local-card" key={entry.id}>
            <div className="team-local-card-head">
              <FileCode2 size={19}/>
              <div>
                <strong>{draft.semanticName || 'Untitled semantic model'}</strong>
                <p>{draft.sourceModel || 'No staging model'} · {draft.contract || 'Independent team model'}</p>
              </div>
            </div>
            <div className="team-local-card-footer">
              <span className={issues.length ? 'team-local-incomplete' : 'team-local-ready'}>
                {issues.length ? <AlertCircle size={14}/> : <CheckCircle2 size={14}/>}
                {issues.length ? 'In progress' : 'Locally valid'}
              </span>
              <div className="team-local-card-actions">
                <button type="button" className="outline" onClick={() => openDraft(entry)}>Edit Draft</button>
                <button type="button" className="team-delete" aria-label={`Delete ${draft.semanticName || draft.sourceModel} local draft`} onClick={() => removeDraft(entry)}><Trash2 size={16}/></button>
              </div>
            </div>
          </article>
        })}
      </div>}
      <p className="team-demo-note">Drafts are stored only in this browser and may be lost if browser storage is cleared. Download SQL and YAML as backups. GitHub PR publishing and dbt Core validation against the federated project are paused.</p>
    </main>
  </div>
}
