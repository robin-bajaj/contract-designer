import React, { useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import yaml from 'js-yaml'
import { ArrowLeft, ArrowRight, CheckCircle2, ChevronDown, CircleAlert, Code2, Download, FilePlus2, FolderTree, GitBranch, Layers, Link2, Plus, RotateCcw, Save, Search, Trash2, Upload, X } from 'lucide-react'
import { initialContracts, toContractDocument, validateContract } from './contracts'
import './styles.css'

const clone = value => JSON.parse(JSON.stringify(value))
const types = ['text', 'integer', 'bigint', 'numeric', 'date', 'boolean']
const download = (name, text, mime = 'text/yaml') => {
  const file = new Blob([text], { type: mime })
  const url = URL.createObjectURL(file)
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url)
}
const toYaml = c => yaml.dump(toContractDocument(c), { noRefs: true, lineWidth: 100, sortKeys: false })
function App() {
  const [contracts, setContracts] = useState(clone(initialContracts))
  const [activeId, setActiveId] = useState(null)
  const [search, setSearch] = useState('')
  const [view, setView] = useState('canvas')
  const [showYaml, setShowYaml] = useState(false)
  const [notice, setNotice] = useState('')
  const [validation, setValidation] = useState(null)
  const importRef = useRef(null)
  const active = contracts.find(c => c.id === activeId)
  const filtered = contracts.filter(c => c.name.toLowerCase().includes(search.toLowerCase()))
  const selectedYaml = active ? toYaml(active) : ''
  const currentIssues = active ? validateContract(active, contracts) : []
  const update = updater => {
    setContracts(all => all.map(c => c.id === activeId ? updater(clone(c)) : c))
    setValidation(null)
  }
  const updateField = (key, value) => update(c => ({ ...c, [key]: value }))
  const updateItem = (kind, index, key, value) => update(c => { c[kind][index][key] = value; return c })
  const addContract = child => {
    const prefix = child ? 'cdo.new_concept' : 'new_contract'
    const base = prefix; let name = base; let suffix = 2
    while (contracts.some(c => c.name === name)) name = `${base}_${suffix++}`
    const parent = contracts.find(c => c.name === 'cdo.all') || contracts.find(c => !c.uses)
    const item = { id: name, name, version: 1, description: '', uses: child && parent ? { name: parent.name, version: parent.version } : null, include: child ? { attributes: [], metrics: [] } : null, attributes: [], metrics: [] }
    setContracts(old => [...old, item]); setActiveId(item.id); setView('edit'); setNotice('New draft created. Export YAML to save it in a repository.'); setValidation(null)
  }
  const removeContract = id => {
    if (contracts.some(c => c.uses?.name === contracts.find(x => x.id === id)?.name)) { setNotice('Cannot remove this contract: a child contract depends on it.'); return }
    setContracts(old => old.filter(c => c.id !== id)); if (activeId === id) { setActiveId(null); setView('canvas') }
  }
  const open = id => { setActiveId(id); setView('edit'); setShowYaml(false); setValidation(null); setNotice('') }
  const importContract = async e => {
    const f = e.target.files?.[0]; if (!f) return
    try {
      const raw = yaml.load(await f.text())
      if (!raw || typeof raw !== 'object' || !raw.name || !raw.version) throw Error('Expected a contract with name and version.')
      const child = Boolean(raw.uses)
      const c = { id: `import-${Date.now()}`, name: raw.name, version: Number(raw.version), description: raw.description || '', uses: child ? raw.uses : null, include: child ? { attributes: raw.include?.attributes || [], metrics: raw.include?.metrics || [] } : null, attributes: child ? [] : raw.attributes || [], metrics: child ? [] : raw.metrics || [] }
      const existing = contracts.find(x => x.name === c.name && Number(x.version) === Number(c.version))
      if (existing) { setContracts(all => all.map(x => x.id === existing.id ? { ...c, id: existing.id } : x)); open(existing.id) }
      else { setContracts(all => [...all, c]); open(c.id) }
      setNotice(`Imported ${f.name}. Changes remain local until you export.`)
    } catch(err) { setNotice(`Import failed: ${err.message}`) }
    e.target.value = ''
  }
  const parent = active?.uses ? contracts.find(c => c.name === active.uses.name && Number(c.version) === Number(active.uses.version)) : null
  const inheritedAttrs = parent?.uses ? (parent.include?.attributes || []) : parent?.attributes.map(a => a.name) || []
  const inheritedMetrics = parent?.uses ? (parent.include?.metrics || []) : parent?.metrics.map(m => m.name) || []
  const metrics = active?.metrics || []
  const cards = filtered
  return <div className="app-shell">
    <header className="topbar"><div className="brand"><GitBranch size={23}/><strong>CONTRACT DESIGNER</strong></div><span className="tagline">Design standalone and parent/child business contracts with live lineage</span><div className="top-actions"><span className="pill">Frontend prototype · Local drafts</span></div></header>
    <div className="workspace">
      <aside className="sidebar">
        <div className="section-label">MY CONTRACTS</div>
        <div className="search"><Search size={17}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search contracts..."/></div>
        <div className="folder-label"><FolderTree size={17}/> My Contracts</div>
        <div className="small-actions"><button onClick={() => addContract(false)}><Plus size={13}/> Standalone</button><button onClick={() => addContract(true)}><Plus size={13}/> Child</button></div>
        <nav className="contract-nav">{filtered.map(c => <div key={c.id} className={`nav-item ${activeId === c.id ? 'selected' : ''}`}><button className="nav-link" onClick={() => open(c.id)}>{c.uses ? <Link2 size={17}/> : <Layers size={17}/>}<span>{c.name}</span></button><button className="icon-quiet danger" title="Delete draft" onClick={() => removeContract(c.id)}><X size={15}/></button></div>)}</nav>
        <div className="sidebar-bottom"><button className="outline stretch" onClick={() => importRef.current?.click()}><Upload size={15}/> Import contract YAML</button><input ref={importRef} accept=".yml,.yaml,text/yaml" type="file" hidden onChange={importContract}/><p>Contracts loaded as local drafts. Export YAML and review it through your normal GitHub PR process.</p></div>
      </aside>
      <main className="main-content">
        {notice && <div className="notice"><CircleAlert size={16}/><span>{notice}</span><button className="icon-quiet" onClick={() => setNotice('')}><X size={15}/></button></div>}
        {view === 'canvas' ? <>
          <div className="page-head"><h1>My Contracts</h1><div className="head-actions"><button className="primary" onClick={() => addContract(false)}><Plus size={18}/> New Contract</button><button className="outline" onClick={() => { setContracts(clone(initialContracts)); setNotice('Example contracts restored.'); setActiveId(null) }}><RotateCcw size={15}/> Reset samples</button></div></div>
          <p className="muted">Contract lineage • click any contract to edit its definition</p>
          <div className="graph-area"><ContractGraph contracts={cards} onOpen={open}/></div>
        </> : active ? <>
          <div className="editor-actions"><button className="outline" onClick={() => {setView('canvas'); setValidation(null)}}><ArrowLeft size={16}/> Back to Contracts</button><div className="head-actions"><button className="outline" onClick={() => setShowYaml(v => !v)}><Code2 size={16}/>{showYaml ? 'Hide YAML' : 'Preview YAML'}</button><button className="primary" onClick={() => { const errors = validateContract(active, contracts);setValidation(errors);setNotice(errors.length ? 'Please resolve validation issues before exporting.' : 'Local structural checks passed. CI remains the authoritative contract validator.') }}><CheckCircle2 size={16}/> Validate</button><button className="primary" onClick={() => { if(currentIssues.length) {setValidation(currentIssues);setNotice('Resolve validation issues before exporting.');return} download(`${active.name.replaceAll('.', '_')}_v${active.version}.yml`, selectedYaml); setNotice('YAML exported. Submit it through a GitHub PR for authoritative validation.')}}><Download size={16}/> Export YAML</button></div></div>
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
              <div className="table-scroll"><table><thead><tr><th>Attribute Name</th><th>Data Type</th><th>Description</th><th>Action</th></tr></thead><tbody>{active.attributes.map((a,i) => <tr key={i}><td><input value={a.name} onChange={e=>updateItem('attributes',i,'name',e.target.value)}/></td><td><select value={a.data_type} onChange={e=>updateItem('attributes',i,'data_type',e.target.value)}>{types.map(t=><option key={t}>{t}</option>)}</select></td><td><input value={a.description || ''} onChange={e=>updateItem('attributes',i,'description',e.target.value)}/></td><td><button className="remove" onClick={() => update(c => ({...c,attributes:c.attributes.filter((_,j)=>j!==i)}))}><Trash2 size={15}/></button></td></tr>)}</tbody></table></div><button className="primary add-button" onClick={() => update(c => ({...c,attributes:[...c.attributes,{name:'new_attribute',data_type:'text',description:''}]}))}><Plus size={17}/> Add Attribute</button>
              <h3 className="section-title">Metrics</h3><p className="muted">Define metric formulas. The CDO validator will check the actual contract registry.</p>
              <div className="table-scroll"><table><thead><tr><th>Metric Name</th><th>Type</th><th>Expression</th><th>Aggregation</th><th>Fill Nulls</th><th>Action</th></tr></thead><tbody>{metrics.map((m,i)=><tr key={i}><td><input value={m.name} onChange={e=>updateItem('metrics',i,'name',e.target.value)}/></td><td><select value={m.type||'simple'} onChange={e=>updateItem('metrics',i,'type',e.target.value)}><option>simple</option></select></td><td><select value={m.expr} onChange={e=>updateItem('metrics',i,'expr',e.target.value)}><option value="">Select field</option>{active.attributes.map(a=><option key={a.name} value={a.name}>{a.name}</option>)}</select></td><td><select value={m.agg||'sum'} onChange={e=>updateItem('metrics',i,'agg',e.target.value)}><option>sum</option><option>count</option></select></td><td><input type="number" value={m.fill_nulls_with??''} onChange={e=>updateItem('metrics',i,'fill_nulls_with',e.target.value)}/></td><td><button className="remove" onClick={() => update(c => ({...c, metrics:c.metrics.filter((_,j)=>j!==i)}))}><Trash2 size={15}/></button></td></tr>)}</tbody></table></div><button className="primary add-button" onClick={() => update(c=>({...c,metrics:[...c.metrics,{name:'new_metric',type:'simple',agg:'sum',expr:c.attributes[0]?.name||'',description:''}]}))}><Plus size={17}/> Add Metric</button>
              {metrics.map((m,i)=><label className="full-field metric-description" key={i}>Description: {m.name}<input value={m.description || ''} onChange={e=>updateItem('metrics',i,'description',e.target.value)} placeholder="Metric business meaning"/></label>)}
            </>}
            {validation && <div className={`validation ${validation.length?'invalid':'valid'}`}>{validation.length ? <><strong>{validation.length} validation issue(s)</strong>{validation.map((msg,i)=><div key={i}>• {msg}</div>)}</> : <><CheckCircle2 size={17}/> Local structural checks passed. Run the CDO Python registry validator after exporting.</>}</div>}
            {showYaml && <div className="yaml-preview"><div className="yaml-head"><strong>Generated contract YAML</strong><button className="outline" onClick={() => navigator.clipboard?.writeText(selectedYaml)}>Copy</button></div><pre>{selectedYaml}</pre></div>}
          </div>
        </> : <p>Choose a contract to edit.</p>}
      </main>
    </div>
  </div>
}
function ContractGraph({contracts,onOpen}) {
  const parents = contracts.filter(c => !c.uses)
  const children = contracts.filter(c => !!c.uses)
  if (!contracts.length) return <p className="muted">No contracts match your search.</p>
  const ordered = [...parents, ...children]
  const width = Math.max(650, ordered.length * 220 + 60)
  const positions = Object.fromEntries(ordered.map((c,i)=>[c.id,{x:40+i*220,y:c.uses?250:42}]))
  return <div className="graph-scroll"><div className="graph-content" style={{minWidth:width,height:475}}>
    <svg className="connections" width={width} height="430">{children.map(c=>{const from=ordered.find(x=>x.name===c.uses.name);const a=from&&positions[from.id];const b=positions[c.id];if(!a||!b)return null;return <path key={c.id} d={`M${a.x+91} ${a.y+138} V${b.y-35} H${b.x+91} V${b.y-7}`} fill="none" stroke="#009c58" strokeWidth="2.2" markerEnd="url(#arrow)"/>})}<defs><marker id="arrow" markerWidth="7" markerHeight="7" refX="4" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6" fill="none" stroke="#009c58" strokeWidth="1.5"/></marker></defs></svg>
    {ordered.map(c => <button key={c.id} className={`contract-card ${c.uses?'child':''}`} style={{left:positions[c.id].x,top:positions[c.id].y}} onClick={()=>onOpen(c.id)}><span className="card-emoji">{c.uses?'🔗':'📦'}</span><strong>{c.name}</strong><span className="card-badge">{c.uses?'CHILD CONTRACT':'STANDALONE CONTRACT'}</span><small>{c.uses ? `uses ${c.uses.name}` : `v${c.version} · ${c.attributes.length} attributes, ${c.metrics.length} metrics`}</small></button>)}
  </div></div>
}

createRoot(document.getElementById('root')).render(<App/>)
