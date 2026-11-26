import React, { useEffect, useMemo, useRef, useState } from 'react'
import yaml from 'js-yaml'
import { ArrowLeft, ArrowRight, CheckCircle2, ChevronDown, CircleAlert, Code2, Download, FilePlus2, FolderTree, GitBranch, Layers, Link2, Plus, RotateCcw, Save, Search, Trash2, Upload, X } from 'lucide-react'
import { toContractDocument, validateContract } from './domain/contracts/contracts.js'
import ContractCanvas from './features/canvas/ContractCanvas.jsx'
import ContractExplorer from './features/explorer/ContractExplorer.jsx'
import PublishPanel from './features/editor/PublishPanel.jsx'
import { contractFilename } from './domain/contracts/contractTree.js'
import { DATA_TYPES, METRIC_TYPES, SIMPLE_AGGREGATIONS } from './domain/contracts/dbtOptions.js'

import { fetchGovernanceContracts } from './services/github/githubRegistry.js'
import { restoreRegistryBaseline, persistRegistryBaseline } from './services/storage/registryCache.js'
import { publishContractPR, GOVERNANCE_REPO } from './services/github/githubPublish.js'
import './styles.css'

const clone = value => JSON.parse(JSON.stringify(value))
const download = (name, text, mime = 'text/yaml') => {
  const file = new Blob([text], { type: mime })
  const url = URL.createObjectURL(file)
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url)
}
const toYaml = c => yaml.dump(toContractDocument(c), { noRefs: true, lineWidth: 100, sortKeys: false })
function App() {
  const [contracts, setContracts] = useState(restoreRegistryBaseline)
  const [draftContract, setDraftContract] = useState(null)
  const [activeId, setActiveId] = useState(null)
  const [search, setSearch] = useState('')
  const [view, setView] = useState('canvas')
  const [showYaml, setShowYaml] = useState(true)
  const [notice, setNotice] = useState('')
  const [validation, setValidation] = useState(null)
  const [githubToken, setGithubToken] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [publishedPR, setPublishedPR] = useState(null)
  const [syncingRegistry, setSyncingRegistry] = useState(false)
  const [registryStatus, setRegistryStatus] = useState('')
  const syncGitHub = async (token = '', silent = false) => {
    setSyncingRegistry(true)
    try {
      const remote = await fetchGovernanceContracts(fetch, token)
      // GitHub main is the sole source for the catalog: never merge local samples or drafts.
      setContracts(remote)
      persistRegistryBaseline(remote)
      setDraftContract(null)
      setActiveId(null)
      setView('canvas')
      const summary = `${remote.length} approved contracts loaded from GitHub main.`
      setRegistryStatus(summary)
      if (!silent) setNotice(summary)
    } catch (error) {
      setRegistryStatus(`GitHub sync unavailable: ${error.message}. Showing last loaded GitHub snapshot, if available.`)
      if (!silent) setNotice(`GitHub sync failed: ${error.message}`)
    } finally { setSyncingRegistry(false) }
  }
  useEffect(() => { syncGitHub('', true) }, []) // Load approved main-branch contracts on startup.
  const publish = async () => {
    if (!active || publishing) return
    const errors = validateContract(active, contracts)
    setValidation(errors)
    if (errors.length) { setNotice('Resolve validation issues before submitting a pull request.'); return }
    setPublishing(true); setPublishedPR(null)
    try {
      const result = await publishContractPR({ contract: active, yamlText: selectedYaml, token: githubToken })
      setPublishedPR(result)
      setNotice(`Pull request #${result.number} created in ${GOVERNANCE_REPO}. Review and merge after CI validation.`)
    } catch (error) { setNotice(`GitHub publish failed: ${error.message}`) }
    finally { setPublishing(false) }
  }
  const importRef = useRef(null)
  const yamlRef = useRef(null)
  const active = draftContract?.id === activeId ? draftContract : contracts.find(c => c.id === activeId)
  const filtered = contracts.filter(c => c.name.toLowerCase().includes(search.toLowerCase()))
  const selectedYaml = active ? toYaml(active) : ''
  const currentIssues = active ? validateContract(active, contracts) : []
  const update = updater => {
    if (draftContract?.id === activeId) setDraftContract(current => updater(clone(current)))
    else { const current = contracts.find(c => c.id === activeId); if (current) setDraftContract(updater(clone(current))) }
    setValidation(null)
  }
  const updateField = (key, value) => update(c => ({ ...c, [key]: value }))
  const updateItem = (kind, index, key, value) => update(c => { c[kind][index][key] = value; return c })
  const addContract = (child, selectedParent = null) => {
    const prefix = child ? `${selectedParent?.name || active?.name || 'cdo'}.new_concept` : 'new_contract'
    const base = prefix; let name = base; let suffix = 2
    while (contracts.some(c => c.name === name)) name = `${base}_${suffix++}`
    const parent = selectedParent || (active && contracts.some(c => c.id === active.id) ? active : null) || contracts.find(c => c.name === 'cdo.all') || contracts.find(c => !c.uses)
    const item = { id: name, name, version: 1, description: '', uses: child && parent ? { name: parent.name, version: parent.version } : null, include: child ? { attributes: [], metrics: [] } : null, attributes: [], metrics: [] }
    setDraftContract(item); setActiveId(item.id); setView('edit'); setShowYaml(true); setNotice('Unpublished editor draft. Publish through a PR; it appears in the catalog only after merge.'); setValidation(null)
  }
  const removeContract = id => {
    if (contracts.some(c => c.uses?.name === contracts.find(x => x.id === id)?.name)) { setNotice('Cannot remove this contract: a child contract depends on it.'); return }
    setNotice('The catalog is GitHub-only. Remove contracts through a governance repository pull request.')
  }
  const open = id => { setDraftContract(null); setActiveId(id); setView('edit'); setShowYaml(true); setValidation(null); setNotice('') }
  const importContract = async e => {
    const f = e.target.files?.[0]; if (!f) return
    try {
      const raw = yaml.load(await f.text())
      if (!raw || typeof raw !== 'object' || !raw.name || !raw.version) throw Error('Expected a contract with name and version.')
      const child = Boolean(raw.uses)
      const c = { id: `import-${Date.now()}`, name: raw.name, version: Number(raw.version), description: raw.description || '', uses: child ? raw.uses : null, include: child ? { attributes: raw.include?.attributes || [], metrics: raw.include?.metrics || [] } : null, attributes: child ? [] : raw.attributes || [], metrics: child ? [] : raw.metrics || [] }
      const existing = contracts.find(x => x.name === c.name && Number(x.version) === Number(c.version))
      setDraftContract({ ...c, id: existing?.id || c.id }); setActiveId(existing?.id || c.id); setView('edit'); setShowYaml(true)
      setNotice(`Imported ${f.name} into the editor only. It will not appear in the GitHub catalog until published and merged.`)
    } catch(err) { setNotice(`Import failed: ${err.message}`) }
    e.target.value = ''
  }
  const parent = active?.uses ? contracts.find(c => c.name === active.uses.name && Number(c.version) === Number(active.uses.version)) : null
  const inheritedAttrs = parent?.uses ? (parent.include?.attributes || []) : parent?.attributes.map(a => a.name) || []
  const inheritedMetrics = parent?.uses ? (parent.include?.metrics || []) : parent?.metrics.map(m => m.name) || []
  const metrics = active?.metrics || []
  const cards = filtered
  return <div className="app-shell">
    <header className="topbar"><div className="brand"><GitBranch size={23}/><strong>CONTRACT DESIGNER</strong></div><span className="tagline">Design standalone and parent/child business contracts with live lineage</span><div className="top-actions"><span className="pill">GitHub registry · main branch</span></div></header>
    <div className="workspace">
      <aside className="sidebar">
        <div className="section-label">MY CONTRACTS</div>
        <div className="search"><Search size={17}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search contracts..."/></div>
        <div className="folder-label"><FolderTree size={17}/> My Contracts</div>
        <button className="outline stretch" disabled={syncingRegistry} onClick={() => syncGitHub(githubToken)}><RotateCcw size={15}/>{syncingRegistry ? "Syncing GitHub..." : "Sync from GitHub"}</button>
        {registryStatus && <p className="registry-sync-status" role="status">{registryStatus}</p>}
        <ContractExplorer contracts={contracts} search={search} activeId={activeId} onOpen={open} onRemove={null} onAddChild={parent => addContract(true, parent)}/>
        <div className="sidebar-bottom"><button className="outline stretch" onClick={() => importRef.current?.click()}><Upload size={15}/> Import contract YAML</button><input ref={importRef} accept=".yml,.yaml,text/yaml" type="file" hidden onChange={importContract}/><p>Only approved contracts on governance GitHub main appear here. Unpublished work remains in the editor; export YAML as a backup before leaving or publish through a PR.</p></div>
      </aside>
      <main className="main-content">
        {notice && <div className="notice"><CircleAlert size={16}/><span>{notice}</span><button className="icon-quiet" onClick={() => setNotice('')}><X size={15}/></button></div>}
        {view === 'canvas' ? <>
          <div className="page-head"><h1>My Contracts</h1></div>
          <p className="muted">Left-drag the canvas to pan or move contracts. Right-click blank space to create a standalone contract, or right-click a contract for options.</p>
          <div className="graph-area"><ContractCanvas contracts={cards} onOpen={open} onCreateStandalone={() => addContract(false)} onCreateChild={parent => addContract(true, parent)}/></div>
        </> : active ? <>
          <div className="editor-actions"><button className="outline" onClick={() => {setView('canvas'); setValidation(null)}}><ArrowLeft size={16}/> Back to Contracts</button><div className="head-actions"><button className="outline" onClick={() => {setShowYaml(true); window.requestAnimationFrame(() => yamlRef.current?.scrollIntoView({behavior:'smooth',block:'start'}))}}><Code2 size={16}/>View YAML</button><button className="primary" onClick={() => { const errors = validateContract(active, contracts);setValidation(errors);setNotice(errors.length ? 'Please resolve validation issues before exporting.' : 'Local structural checks passed. CI remains the authoritative contract validator.') }}><CheckCircle2 size={16}/> Validate</button><button className="primary" onClick={() => { if(currentIssues.length) {setValidation(currentIssues);setNotice('Resolve validation issues before exporting.');return} download(contractFilename(active), selectedYaml); setNotice('YAML exported. Submit it through a GitHub PR for authoritative validation.')}}><Download size={16}/> Export YAML</button></div></div>
          <PublishPanel contract={active} token={githubToken} onTokenChange={setGithubToken} onPublish={publish}
            isPublishing={publishing} pullRequest={publishedPR}/>
          <div className="editor-panel">
            <div className="editor-intro"><span className="eyebrow">{active.uses ? 'CHILD CONTRACT' : 'STANDALONE CONTRACT'}</span><p>{active.uses ? 'Select definitions to inherit from a versioned parent contract' : 'Define reusable enterprise business attributes and governed metrics'}</p></div>
            <h3 className="section-title">Contract Details</h3>
            <div className="form-grid"><label>Contract Name<input value={active.name} onChange={e => updateField('name', e.target.value)}/></label><label>Contract Version<input type="number" min="1" value={active.version} onChange={e => updateField('version', Number(e.target.value))}/></label></div>
            <label className="full-field">Description<input value={active.description} onChange={e => updateField('description', e.target.value)}/></label>
            {active.uses ? <>
              <h3 className="section-title">Parent Contract</h3>
              <div className="form-grid"><label>Parent<select value={active.uses.name} onChange={e => update(c => ({...c, uses: {name: e.target.value, version: contracts.find(p => p.name === e.target.value)?.version || 1}, include: {attributes: [], metrics: []}}))}>{contracts.filter(c => c.id !== active.id).map(c => <option key={c.id} value={c.name}>{c.name}</option>)}</select></label><label>Parent Version<input value={active.uses.version} type="number" min="1" onChange={e => update(c => ({ ...c, uses: {...c.uses, version: Number(e.target.value)} }))}/></label></div>
              <h3 className="section-title">Inherited Attributes <span className="subtitle">Select fields to include · parent definitions are read-only</span></h3>
              {inheritedAttrs.length ? <div className="check-grid">{inheritedAttrs.map(name => <label className="check-field" key={name}><input type="checkbox" checked={active.include?.attributes.includes(name) || false} onChange={e => update(c => ({...c, include: {...c.include, attributes: e.target.checked ? [...c.include.attributes, name] : c.include.attributes.filter(x => x !== name)}}))}/><span>{name}</span></label>)}</div> : <p className="muted">Select a parent that defines attributes.</p>}
              <h3 className="section-title">Inherited Metrics <span className="subtitle">Choose governed formulas to inherit unchanged</span></h3>
              {inheritedMetrics.length ? <div className="check-grid">{inheritedMetrics.map(name => <label className="check-field" key={name}><input type="checkbox" checked={active.include?.metrics.includes(name) || false} onChange={e => update(c => ({...c, include: {...c.include, metrics: e.target.checked ? [...c.include.metrics, name] : c.include.metrics.filter(x => x !== name)}}))}/><span>{name}</span></label>)}</div> : <p className="muted">No metrics found on the selected parent.</p>}
            </> : <>
              <h3 className="section-title">Attributes</h3><p className="muted">Define canonical business attributes for this contract</p>
              <div className="table-scroll"><table><thead><tr><th>Attribute Name</th><th>Data Type</th><th>Description</th><th>Action</th></tr></thead><tbody>{active.attributes.map((a,i) => <tr key={i}><td><input value={a.name} onChange={e=>updateItem('attributes',i,'name',e.target.value)}/></td><td><select value={a.data_type} onChange={e=>updateItem('attributes',i,'data_type',e.target.value)}>{!DATA_TYPES.includes(a.data_type) && <option value={a.data_type}>{a.data_type} (imported)</option>}{DATA_TYPES.map(t=><option key={t} value={t}>{t}</option>)}</select></td><td><input value={a.description || ''} onChange={e=>updateItem('attributes',i,'description',e.target.value)}/></td><td><button className="remove" title={`Delete attribute ${a.name}`} aria-label={`Delete attribute ${a.name}`} onClick={() => update(c => ({...c,attributes:c.attributes.filter((_,j)=>j!==i)}))}><Trash2 size={15}/></button></td></tr>)}</tbody></table></div><button className="primary add-button" onClick={() => update(c => ({...c,attributes:[...c.attributes,{name:'new_attribute',data_type:'text',description:''}]}))}><Plus size={17}/> Add Attribute</button>
              <h3 className="section-title">Metrics</h3><p className="muted">Define dbt-compatible simple metrics using an attribute expression and supported aggregation. Advanced metric kinds require a separate configuration schema.</p>
              <div className="table-scroll metric-table"><table><thead><tr><th>Metric Name</th><th>Type</th><th>Expression (attribute)</th><th>Aggregation</th><th>Description</th><th>Action</th></tr></thead><tbody>{metrics.map((m,i)=><tr key={i}>
                <td><input aria-label={`Metric ${i+1} name`} value={m.name} onChange={e=>updateItem('metrics',i,'name',e.target.value)}/></td>
                <td><select aria-label={`Metric ${i+1} type`} value={m.type||'simple'} onChange={e=>updateItem('metrics',i,'type',e.target.value)}>
                  {!METRIC_TYPES.includes(m.type) && m.type && <option value={m.type}>{m.type} (imported)</option>}
                  {METRIC_TYPES.map(type=><option key={type} value={type}>{type}</option>)}</select></td>
                <td><select aria-label={`Metric ${i+1} expression`} value={m.expr||''} onChange={e=>updateItem('metrics',i,'expr',e.target.value)}>
                  <option value="">Select attribute</option>
                  {m.expr && !active.attributes.some(a=>a.name===m.expr) && <option value={m.expr}>{m.expr} (imported)</option>}
                  {active.attributes.map(a=><option key={a.name} value={a.name}>{a.name}</option>)}</select></td>
                <td><select aria-label={`Metric ${i+1} aggregation`} value={m.agg||'sum'} onChange={e=>updateItem('metrics',i,'agg',e.target.value)}>
                  {!SIMPLE_AGGREGATIONS.includes(m.agg) && m.agg && <option value={m.agg}>{m.agg} (imported)</option>}
                  {SIMPLE_AGGREGATIONS.map(agg=><option key={agg} value={agg}>{agg}</option>)}</select></td>
                <td><input aria-label={`Metric ${i+1} description`} value={m.description||''} onChange={e=>updateItem('metrics',i,'description',e.target.value)} placeholder="Business meaning"/></td>
                <td><button className="remove" title={`Delete metric ${m.name}`} aria-label={`Delete metric ${m.name}`} onClick={()=>update(c=>({...c,metrics:c.metrics.filter((_,j)=>j!==i)}))}><Trash2 size={15}/></button></td>
              </tr>)}</tbody></table></div>
              <button className="primary add-button" onClick={()=>update(c=>({...c,metrics:[...c.metrics,{name:'new_metric',type:'simple',agg:'sum',expr:c.attributes[0]?.name||'',description:''}]}))}><Plus size={17}/> Add Metric</button>
            </>}
            {validation && <div className={`validation ${validation.length?'invalid':'valid'}`}>{validation.length ? <><strong>{validation.length} validation issue(s)</strong>{validation.map((msg,i)=><div key={i}>• {msg}</div>)}</> : <><CheckCircle2 size={17}/> Local structural checks passed. Run the CDO Python registry validator after exporting.</>}</div>}
            {showYaml && <div className="yaml-preview" ref={yamlRef}>
              <div className="yaml-head"><div className="yaml-file-label"><Code2 size={18}/><div><strong>Live YAML preview</strong><small>{contractFilename(active)} · v{active.version} · contract definition</small></div></div>
                <div className="yaml-buttons"><button type="button" className="outline" onClick={() => navigator.clipboard?.writeText(selectedYaml)}>Copy YAML</button><button type="button" className="outline" onClick={() => { if(currentIssues.length) {setValidation(currentIssues);setNotice('Resolve validation issues before exporting.');return} download(contractFilename(active), selectedYaml); setNotice('YAML downloaded. Submit it through a GitHub PR for authoritative validation.') }}><Download size={15}/> Download .yml</button><button type="button" className="icon-quiet" aria-label="Hide YAML preview" title="Hide YAML preview" onClick={() => setShowYaml(false)}><X size={16}/></button></div>
              </div><pre aria-label="Generated YAML content"><code>{selectedYaml}</code></pre>
            </div>}
          </div>
        </> : <p>Choose a contract to edit.</p>}
      </main>
    </div>
  </div>
}
export default App
