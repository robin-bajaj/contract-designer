import React from 'react'
import { GitBranch, LogOut } from 'lucide-react'
import { ROLE_OPTIONS } from '../auth/roles.js'
import './WorkspaceHeader.css'

/** Identical application header for every signed-in demo role. */
export default function WorkspaceHeader({ role, roleOptions = ROLE_OPTIONS, onLogout }) {
  const currentRole = roleOptions.find(option => option.id === role)
  return <header className="topbar workspace-header">
    <div className="brand"><GitBranch size={23} aria-hidden="true"/><strong>SEMANTIC GOVERNANCE</strong></div>
    <span className="tagline">Federated semantic contracts and governance</span>
    <div className="top-actions workspace-header-actions">
      <span className="pill" aria-label="Current workspace">{currentRole?.label}</span>
      <button type="button" className="workspace-signout" onClick={onLogout}>
        <LogOut size={16} aria-hidden="true"/> Sign out
      </button>
    </div>
  </header>
}
