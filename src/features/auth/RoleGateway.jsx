import React, { useState } from 'react'
import ContractDesigner from '../../App.jsx'
import LoginPage from './LoginPage.jsx'
import TeamWorkspace from './TeamWorkspace.jsx'
import ProjectConnectionsAdmin from './ProjectConnectionsAdmin.jsx'
import WorkspaceHeader from '../layout/WorkspaceHeader.jsx'
import { canAccessDesigner, isKnownRole } from './roles.js'
import './auth.css'

/** Demo-only UI routing. Server-side authorization must be added before production. */
export default function RoleGateway() {
  const [role, setRole] = useState(null)
  const [cdoView, setCdoView] = useState('contracts')
  const signOut = () => {setRole(null);setCdoView('contracts')}
  if (!isKnownRole(role)) return <LoginPage onLogin={setRole}/>
  return <div className="role-workspace-shell">
    <WorkspaceHeader role={role} onLogout={signOut}/>
    {canAccessDesigner(role) ? <>
      <nav className="portal-admin-switcher" aria-label="CDO workspace sections">
        <button type="button" aria-current={cdoView==='contracts'?'page':undefined} onClick={()=>setCdoView('contracts')}>Contract designer</button>
        <button type="button" aria-current={cdoView==='connections'?'page':undefined} onClick={()=>setCdoView('connections')}>Project connections</button>
      </nav>
      {cdoView==='connections'
        ? <ProjectConnectionsAdmin onBack={()=>setCdoView('contracts')}/>
        : <ContractDesigner/>}
    </> : <TeamWorkspace role={role}/>}
  </div>
}
