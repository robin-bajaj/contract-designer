import React,{useState} from 'react'
import {ArrowLeft,CheckCircle2,Cloud,Database,GitBranch,KeyRound,Link2,ShieldCheck} from 'lucide-react'
import {leadDiscoverProjects,leadPreviewProject,leadConnectProject} from '../../services/portal/projectConnectionApi.js'
import './ProjectConnectionsAdmin.css'

/** Team Lead onboarding. The role selector is only a demo; the Python backend
 * checks a separate team-scoped key before it ever calls dbt Cloud.
 * The dbt token stays in component memory and is erased after successful save.
 */
export default function ProjectConnectionsAdmin({role,onBack}) {
  const [leadKey,setLeadKey]=useState('')
  const [apiHost,setApiHost]=useState('cloud.getdbt.com')
  const [accountId,setAccountId]=useState('')
  const [serviceToken,setServiceToken]=useState('')
  const [projects,setProjects]=useState([])
  const [projectId,setProjectId]=useState('')
  const [preview,setPreview]=useState(null)
  const [environmentId,setEnvironmentId]=useState('')
  const [saved,setSaved]=useState(null)
  const [loading,setLoading]=useState(false)
  const [error,setError]=useState('')
  const team=role==='team-a'?'Team A':'Team C'
  const details=()=>({role,apiHost:apiHost.trim().toLowerCase(),accountId:Number(accountId),serviceToken})
  const resetSelection=()=>{setProjects([]);setProjectId('');setPreview(null);setEnvironmentId('');setSaved(null);setError('')}

  const discover=async(e)=>{
    e.preventDefault();setLoading(true);setError('');setSaved(null)
    try {
      const result=await leadDiscoverProjects(leadKey,details())
      setProjects(result.projects||[])
      setProjectId('');setPreview(null);setEnvironmentId('')
    } catch(e){setError(e.message)}
    finally{setLoading(false)}
  }
  const choose=async(value)=>{
    setProjectId(value);setPreview(null);setEnvironmentId('');setError('')
    if(!value) return
    setLoading(true)
    try {
      const result=await leadPreviewProject(leadKey,{...details(),projectId:Number(value)})
      setPreview(result.project)
      setEnvironmentId(result.project.environments?.[0]?.id ? String(result.project.environments[0].id) : '')
    }catch(e){setError(e.message)}
    finally{setLoading(false)}
  }
  const save=async()=>{
    setLoading(true);setError('')
    try{
      const result=await leadConnectProject(leadKey,{...details(),projectId:Number(projectId),environmentId:Number(environmentId)})
      setSaved(result.connection)
      setServiceToken('') // Never keep the token in the UI after success
      setLeadKey('')
      setProjects([])
      setPreview(null)
    }catch(e){setError(e.message)}
    finally{setLoading(false)}
  }
  return <main className="project-connect-screen">
    <div className="project-connect-heading">
      <button type="button" className="outline" onClick={onBack}><ArrowLeft size={15}/> Back to {team} workspace</button>
      <div><span className="team-label">{team.toUpperCase()} · PROJECT ONBOARDING</span>
        <h1>Connect existing dbt project</h1>
        <p>A {team} Lead connects the team's existing dbt Cloud project once. Other team developers can then discover its models without entering database or GitHub credentials.</p>
      </div>
    </div>
    <div className="project-connect-diagram">
      <span><Cloud size={18}/> Existing dbt Cloud project</span><Link2 size={18}/>
      <span><GitBranch size={18}/> Linked GitHub repository</span><Link2 size={18}/>
      <span><Database size={18}/> {team} workspace</span>
    </div>
    {saved ? <section className="project-connect-panel">
      <h2><CheckCircle2 size={20}/> Connection saved</h2>
      <div className="project-connect-connected"><CheckCircle2 size={19}/>
        <div><strong>{saved.projectName} · {saved.environmentName}</strong>
          <small>{saved.repository} · {saved.branch}</small></div>
      </div>
      <p>Project discovery is ready. The service token was encrypted on the server and cleared from this form.</p>
      <button type="button" className="primary" onClick={onBack}>View {team} models</button>
    </section> : <section className="project-connect-panel">
      <h2><ShieldCheck size={20}/> {team} Lead verification</h2>
      <p>Connect your account once. Your database credentials remain in dbt Cloud. Use a scoped service token with permission to read your dbt projects, environments and Git configuration.</p>
      <form onSubmit={discover}>
        <div className="project-connect-fields">
          <label><KeyRound size={15}/> {team} Lead access code
            <input type="password" autoComplete="off" value={leadKey} onChange={e=>{setLeadKey(e.target.value);resetSelection()}} placeholder="Team Lead access code" required/>
          </label>
          <label>dbt Cloud API host
            <input value={apiHost} onChange={e=>{setApiHost(e.target.value);resetSelection()}} placeholder="cloud.getdbt.com or account.us1.dbt.com" required autoComplete="off"/>
          </label>
          <label>dbt Cloud account ID
            <input type="number" min="1" step="1" value={accountId} onChange={e=>{setAccountId(e.target.value);resetSelection()}} placeholder="Account ID" required/>
          </label>
          <label>dbt Cloud service token
            <input type="password" autoComplete="off" value={serviceToken} onChange={e=>{setServiceToken(e.target.value);resetSelection()}} placeholder="Paste scoped service token" required/>
          </label>
        </div>
        <button className="primary" type="submit" disabled={loading||!leadKey||!accountId||!serviceToken||!apiHost}>
          {loading?'Verifying with dbt Cloud…':'Discover dbt projects'}
        </button>
      </form>
      {projects.length>0 && <div className="project-connect-fields">
        <label>Existing dbt Cloud project
          <select value={projectId} onChange={e=>choose(e.target.value)} disabled={loading}>
            <option value="">Choose project…</option>
            {projects.map(project=><option value={project.id} key={project.id}>{project.name} (#{project.id})</option>)}
          </select>
        </label>
        {preview && <label>Environment
          <select value={environmentId} onChange={e=>setEnvironmentId(e.target.value)}>
            <option value="">Choose environment…</option>
            {preview.environments.map(env=><option value={env.id} key={env.id}>{env.name}</option>)}
          </select>
        </label>}
      </div>}
      {preview && <div className="project-connect-summary">
        <div><strong>Project</strong><span>{preview.name}</span></div>
        <div><strong>Verified GitHub repository</strong><span>{preview.repository}</span></div>
        <div><strong>Branch</strong><span>{preview.defaultBranch}</span></div>
        <div><strong>Project folder</strong><span>{preview.subdirectory||'Repository root'}</span></div>
        <p>We will read the project's committed models. The database connection is managed by dbt Cloud.</p>
      </div>}
      {preview && <button type="button" className="primary" disabled={loading||!environmentId} onClick={save}>
        <Link2 size={15}/>{loading?'Saving connection…':`Connect to ${team}`}
      </button>}
      {error && <p className="project-connect-error" role="alert">{error}</p>}
      <small>Only use this localhost development interface. The Team Lead access code is an interim authorization control; production requires company SSO and centralized secret management. The service token is stored encrypted separately from its local encryption key, never in browser storage.</small>
    </section>}
    <p className="project-connect-footnote">This first milestone provides read-only discovery of existing SQL, YAML and CDO references. Remote editing, live database execution and PR publication are not yet connected. No warehouse password is requested.</p>
  </main>
}
