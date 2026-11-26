import React, { useEffect, useRef, useState } from 'react'
import yaml from 'js-yaml'
import { CircleAlert, FolderTree, RotateCcw, Search, Upload, X } from 'lucide-react'
import { toContractDocument, validateContract } from './domain/contracts/contracts.js'
import ContractCanvas from './features/canvas/ContractCanvas.jsx'
import ContractExplorer from './features/explorer/ContractExplorer.jsx'
import ContractEditor from './features/editor/ContractEditor.jsx'

import { fetchGovernanceContracts } from './services/github/githubRegistry.js'
import { restoreRegistryBaseline, persistRegistryBaseline } from './services/storage/registryCache.js'
import { publishContractPR, GOVERNANCE_REPO } from './services/github/githubPublish.js'
import './styles.css'

const clone = value => JSON.parse(JSON.stringify(value))
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
  const cards = filtered
  return <div className="app-shell">
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
        </> : active ? <ContractEditor
          active={active} contracts={contracts} selectedYaml={selectedYaml}
          validation={validation} setValidation={setValidation} setNotice={setNotice}
          showYaml={showYaml} setShowYaml={setShowYaml} yamlRef={yamlRef}
          onBack={() => { setView('canvas'); setValidation(null) }}
          update={update} updateField={updateField} updateItem={updateItem}
          githubToken={githubToken} setGithubToken={setGithubToken}
          publishing={publishing} publish={publish} publishedPR={publishedPR}
        /> : <p>Choose a contract to edit.</p>}
      </main>
    </div>
  </div>
}
export default App
