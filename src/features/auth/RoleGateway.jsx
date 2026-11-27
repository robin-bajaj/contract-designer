import React, { useState } from 'react'
import ContractDesigner from '../../App.jsx'
import LoginPage from './LoginPage.jsx'
import TeamWorkspace from './TeamWorkspace.jsx'
import WorkspaceHeader from '../layout/WorkspaceHeader.jsx'
import { canAccessDesigner, isKnownRole } from './roles.js'
import './auth.css'

/** Demo-only UI routing. Server-side authorization must be added before production. */
export default function RoleGateway() {
  const [role, setRole] = useState(null)
  const signOut = () => setRole(null)
  if (!isKnownRole(role)) return <LoginPage onLogin={setRole}/>
  return <div className="role-workspace-shell">
    <WorkspaceHeader role={role} onLogout={signOut}/>
    {canAccessDesigner(role) ? <ContractDesigner/> : <TeamWorkspace role={role}/>}
  </div>
}
