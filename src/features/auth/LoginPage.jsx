import React, { useState } from 'react'
import { ArrowRight, GitBranch, LockKeyhole, ShieldCheck, Users } from 'lucide-react'
import { ROLE_OPTIONS, ROLES } from './roles.js'
import './auth.css'

export default function LoginPage({ onLogin }) {
  const [role, setRole] = useState(ROLES.CDO)
  const selected = ROLE_OPTIONS.find(option => option.id === role)

  return <main className="login-screen">
    <section className="login-card" aria-labelledby="login-title">
      <div className="login-brand"><GitBranch size={27}/><span>CONTRACT DESIGNER</span></div>
      <div className="login-intro">
        <div className="login-mark"><ShieldCheck size={24}/></div>
        <h1 id="login-title">Welcome to Semantic Governance</h1>
        <p>Choose a workspace to continue.</p>
      </div>
      <div className="login-role-label" id="role-label">Select your role</div>
      <div className="login-role-options" role="radiogroup" aria-labelledby="role-label">
        {ROLE_OPTIONS.map(option => <label className={`login-role-option ${role === option.id ? 'selected' : ''}`} key={option.id}>
          <input type="radio" name="workspace-role" checked={role === option.id} onChange={() => setRole(option.id)}/>
          <div className="login-role-content">
            <strong>{option.label}</strong>
            <span>{option.description}</span>
          </div>
        </label>)}
      </div>
      <button className="login-continue" type="button" onClick={() => onLogin(selected.id)}>
        Continue as {selected.label}<ArrowRight size={18}/>
      </button>
      <p className="login-disclaimer"><LockKeyhole size={14}/> Demo role selection only. No passwords or real user authentication yet.</p>
    </section>
  </main>
}
