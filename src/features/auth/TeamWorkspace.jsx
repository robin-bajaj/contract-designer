import React from 'react'
import { GitBranch, Layers3, LogOut } from 'lucide-react'
import { ROLE_OPTIONS } from './roles.js'
import './auth.css'

export default function TeamWorkspace({ role, onLogout }) {
  const workspace = ROLE_OPTIONS.find(option => option.id === role)
  return <div className="team-page">
    <header className="topbar">
      <div className="brand"><GitBranch size={23}/><strong>SEMANTIC GOVERNANCE</strong></div>
      <div className="top-actions team-header-actions">
        <span className="pill">{workspace?.label || 'Team workspace'}</span>
        <button type="button" className="session-logout" onClick={onLogout}><LogOut size={16}/> Sign out</button>
      </div>
    </header>
    <main className="team-content">
      <div className="team-workspace-icon"><Layers3 size={27}/></div>
      <h1>{workspace?.label} workspace</h1>
      <p>This workspace is reserved for {workspace?.label} semantic model ownership and contract adoption workflows.</p>
      <div className="team-upcoming">
        <strong>Workspace coming next</strong>
        <p>Team-specific contract implementation, inheritance mappings, and dbt integration will be added here. CDO contract editing and GitHub publishing are not available in this workspace.</p>
      </div>
      <p className="team-demo-note">Prototype role selection only — access is not enforced by a server.</p>
    </main>
  </div>
}
