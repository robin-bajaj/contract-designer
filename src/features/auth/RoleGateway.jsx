import React, { useEffect, useState } from 'react'
import ContractDesigner from '../../App.jsx'
import LoginPage from './LoginPage.jsx'
import TeamWorkspace from './TeamWorkspace.jsx'
import WorkspaceHeader from '../layout/WorkspaceHeader.jsx'
import { canAccessDesigner, ROLE_OPTIONS } from './roles.js'
import './auth.css'

/** Demo-only UI routing. Server-side authorization is required for production. */
export default function RoleGateway() {
  const [role, setRole] = useState(null)
  const [roleOptions, setRoleOptions] = useState(ROLE_OPTIONS)
  useEffect(() => {
    let active = true
    fetch('/api/teams').then(response => {
      if (!response.ok) throw Error('Cannot load team catalog')
      return response.json()
    }).then(result => {
      if (active && Array.isArray(result.roles) && result.roles.length) setRoleOptions(result.roles)
    }).catch(() => {}) // Keep built-in demo roles when the API is offline.
    return () => { active = false }
  }, [])
  const registerTeam = async team => {
    const response = await fetch('/api/teams/register', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(team),
    })
    const result = await response.json()
    if (!response.ok || !result.ok) throw Error(result.error || 'Could not register team')
    setRoleOptions(current => current.some(x => x.id === result.team.id)
      ? current : [...current, result.team])
    return result.team
  }
  const signOut = () => setRole(null)
  if (!roleOptions.some(option => option.id === role))
    return <LoginPage onLogin={setRole} options={roleOptions} onRegister={registerTeam}/>
  return <div className="role-workspace-shell">
    <WorkspaceHeader role={role} roleOptions={roleOptions} onLogout={signOut}/>
    {canAccessDesigner(role) ? <ContractDesigner/> : <TeamWorkspace role={role} roleOptions={roleOptions}/>}
  </div>
}
