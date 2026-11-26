import React, { useState } from 'react'
import { LogOut } from 'lucide-react'
import ContractDesigner from '../../App.jsx'
import LoginPage from './LoginPage.jsx'
import TeamWorkspace from './TeamWorkspace.jsx'
import { canAccessDesigner, isKnownRole } from './roles.js'
import './auth.css'

/** Demo-only UI routing. Server-side authorization must be added before production. */
export default function RoleGateway() {
  const [role, setRole] = useState(null)
  const signOut = () => setRole(null)
  if (!isKnownRole(role)) return <LoginPage onLogin={setRole}/>
  if (!canAccessDesigner(role)) return <TeamWorkspace role={role} onLogout={signOut}/>
  return <div className="role-cdo-shell">
    <ContractDesigner />
    <div className="role-cdo-controls">
      <span>CDO workspace · Demo</span>
      <button type="button" onClick={signOut}><LogOut size={14}/> Sign out</button>
    </div>
  </div>
}
