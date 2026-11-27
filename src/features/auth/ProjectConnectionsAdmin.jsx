import React,{useState} from 'react'
import {ArrowLeft,CheckCircle2,Cloud,Database,GitBranch,KeyRound,Link2,RefreshCw,ShieldCheck} from 'lucide-react'
import {adminAssignProject,adminProjectPreview,adminProjects} from '../../services/portal/projectConnectionApi.js'
import './ProjectConnectionsAdmin.css'

/** CDO navigation merely reveals this screen; the Python API checks the
 * administrator key independently. Role-picker selection is not authentication.
 */
export default function ProjectConnectionsAdmin({onBack}) {
  const [key,setKey]=useState('')
  const [projects,setProjects]=useState([])
  const [connections,setConnections]=useState([])
  const [projectId,setProjectId]=useState('')
  const [team,setTeam]=useState('team-a')
  const [preview,setPreview]=useState(null)
  const [environmentId,setEnvironmentId]=useState('')
  const [unlocked,setUnlocked]=useState(false)
  const [loading,setLoading]=useState(false)
  const [saving,setSaving]=useState(false)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')

  const unlock=async()=>{
    setLoading(true);setError('');setNotice('')
    try {
      const result=await adminProjects(key)
      setProjects(result.projects||[])
      setConnections(result.connections||[])
      setUnlocked(true)
    } catch(e){setError(e.message);setUnlocked(false)}
    finally{setLoading(false)}
  }
  const choose=async value=>{
    setProjectId(value);setPreview(null);setEnvironmentId('');setError('');setNotice('')
    if(!value) return
    setLoading(true)
    try {
      const response=await adminProjectPreview(key,Number(value))
      const project=response.project
      setPreview(project)
      setEnvironmentId(project.environments?.[0]?.id ? String(project.environments[0].id) : '')
    }catch(e){setError(e.message)}
    finally{setLoading(false)}
  }
  const save=async()=>{
    if(!preview||!environmentId) return
    setSaving(true);setError('');setNotice('')
    try {
      const result=await adminAssignProject(key,team,Number(projectId),Number(environmentId))
      setConnections(old=>[...old.filter(x=>x.role!==team),result.connection].sort((a,b)=>a.role.localeCompare(b.role)))
      setNotice(`${team==='team-a'?'Team A':'Team C'} is connected to ${result.connection.projectName}. Developers can now discover its Git-backed model definitions.`)
    }catch(e){setError(e.message)}
    finally{setSaving(false)}
  }

  return <main className="project-connect-screen">
    <div className="project-connect-heading">
      <button type="button" className="outline" onClick={onBack}><ArrowLeft size={15}/> Back to CDO contracts</button>
      <div><span className="team-label">PLATFORM ADMINISTRATION</span>
      <h1>Connect existing dbt project</h1>
      <p>Link Team A or Team C to an existing dbt Cloud project. Developers will automatically see its approved Git-backed definitions without entering connection credentials.</p></div>
    </div>
    <div className="project-connect-diagram" aria-label="Project integration topology">
      <span><Cloud size={18}/> dbt Cloud project</span><Link2 size={18}/><span><GitBranch size={18}/> Connected GitHub repository</span><Link2 size={18}/><span><Database size={18}/> Team workspace</span>
    </div>
    {!unlocked?<section className="project-connect-panel">
      <h2><ShieldCheck size={20}/> Administrator verification</h2>
      <p>This integration is configured once by an administrator. Team developers never need the dbt API token, GitHub access token, or database password.</p>
      <form onSubmit={e=>{e.preventDefault();unlock()}}>
        <label><KeyRound size={15}/> Portal administrator key
          <input type="password" autoComplete="off" value={key} onChange={e=>setKey(e.target.value)} placeholder="Administrator access key" required/>
        </label>
        <button className="primary" type="submit" disabled={loading||!key}>{loading?'Verifying…':'Unlock project connections'}</button>
      </form>
      <small>The backend administrator configures <code>PORTAL_ADMIN_KEY</code>, <code>DBT_CLOUD_ACCOUNT_ID</code> and <code>DBT_CLOUD_TOKEN</code> once. The dbt token is never entered here, and this key is not stored in browser storage.</small>
    </section>:<>
      <section className="project-connect-panel">
        <div className="project-connect-panel-top"><h2><Cloud size={20}/> Existing project connections</h2>
          <button className="outline" type="button" disabled={loading} onClick={unlock}><RefreshCw size={14}/> Refresh</button></div>
        {connections.length?<div className="project-connect-connections">
          {connections.map(x=><div className="project-connect-connected" key={x.role}>
            <CheckCircle2 size={19}/>
            <div><strong>{x.role==='team-a'?'Team A':'Team C'} · {x.projectName}</strong>
              <small>Environment: {x.environmentName} · Repository: {x.repository} · Branch: {x.branch}</small></div>
          </div>)}
        </div>:<p>No team projects are connected yet.</p>}
      </section>
      <section className="project-connect-panel">
        <h2><Link2 size={20}/> Assign a project to a team</h2>
        <div className="project-connect-fields">
          <label>Team
            <select value={team} onChange={e=>setTeam(e.target.value)}>
              <option value="team-a">Team A — Equities</option><option value="team-c">Team C — Fixed Income</option>
            </select>
          </label>
          <label>Existing dbt Cloud project
            <select value={projectId} onChange={e=>choose(e.target.value)} disabled={loading}>
              <option value="">Select a connected dbt project…</option>
              {projects.map(p=><option key={p.id} value={p.id}>{p.name} (#{p.id})</option>)}
            </select>
          </label>
          {preview && <label>Project environment
            <select value={environmentId} onChange={e=>setEnvironmentId(e.target.value)}>
              <option value="">Select environment…</option>
              {preview.environments.map(env=><option key={env.id} value={env.id}>{env.name}</option>)}
            </select>
          </label>}
        </div>
        {loading && <p role="status">Checking project and repository access…</p>}
        {preview && <div className="project-connect-summary">
          <div><strong>dbt project</strong><span>{preview.name}</span></div>
          <div><strong>Verified GitHub repository</strong><span>{preview.repository}</span></div>
          <div><strong>Default branch</strong><span>{preview.defaultBranch}</span></div>
          <div><strong>Project directory</strong><span>{preview.subdirectory||'Repository root'}</span></div>
          <p>Database credentials remain in dbt Cloud. Connection execution has not been tested by this discovery step.</p>
        </div>}
        <button className="primary" type="button" disabled={loading||saving||!preview||!environmentId} onClick={save}>
          <Link2 size={15}/>{saving?'Saving connection…':'Connect project to team'}
        </button>
        {notice && <p className="project-connect-success" role="status">{notice}</p>}
        {error && <p className="project-connect-error" role="alert">{error}</p>}
      </section>
    </>}
    {!unlocked && error && <p className="project-connect-error" role="alert">{error}</p>}
    <p className="project-connect-footnote">Read-only integration milestone. Existing SQL/YAML is discovered from the verified GitHub repository; live warehouse metadata, remote editing, pre-PR dbt builds and deployment are separate integrations. Demo workspace role selection is not real authentication—backend authorization is enforced for connection changes.</p>
  </main>
}
