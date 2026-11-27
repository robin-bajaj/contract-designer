import React, { useState } from 'react'
import { ArrowRight, GitBranch, LockKeyhole, ShieldCheck } from 'lucide-react'
import { ROLE_OPTIONS, ROLES } from './roles.js'
import './auth.css'

export default function LoginPage({ onLogin, options = ROLE_OPTIONS, onRegister }) {
  const [role, setRole] = useState(ROLES.CDO)
  const [newTeam, setNewTeam] = useState('')
  const [registering, setRegistering] = useState(false)
  const [registrationError, setRegistrationError] = useState('')
  const selected = options.find(option => option.id === role) || options[0]

  const createTeam = async event => {
    event.preventDefault()
    if (!onRegister || registering) return
    const slug = newTeam.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    setRegistering(true)
    setRegistrationError('')
    try {
      const team = await onRegister({ role: 'team-' + slug, label: newTeam.trim() })
      setRole(team.id)
      setNewTeam('')
    } catch (error) { setRegistrationError(error.message) }
    finally { setRegistering(false) }
  }

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
        {options.map(option => <label className={'login-role-option ' + (role === option.id ? 'selected' : '')} key={option.id}>
          <input type="radio" name="workspace-role" checked={role === option.id} onChange={() => setRole(option.id)}/>
          <div className="login-role-content">
            <strong>{option.label}</strong>
            <span>{option.description}</span>
          </div>
        </label>)}
      </div>
      {onRegister && <form className="login-register-panel" onSubmit={createTeam}>
        <label htmlFor="new-team-label">Add another team workspace (demo)</label>
        <div className="login-register-row">
          <input id="new-team-label" value={newTeam} onChange={e => setNewTeam(e.target.value)}
            placeholder="e.g. Risk Analytics" maxLength={70} required/>
          <button type="submit" disabled={registering || !newTeam.trim()}>
            {registering ? 'Adding…' : 'Add team'}
          </button>
        </div>
        {registrationError && <p role="alert">{registrationError}</p>}
      </form>}
      <button className="login-continue" type="button" disabled={!selected} onClick={() => onLogin(selected.id)}>
        Continue as {selected?.label}<ArrowRight size={18}/>
      </button>
      <p className="login-disclaimer"><LockKeyhole size={14}/> Demo role selection only. No passwords or real user authentication yet.</p>
    </section>
  </main>
}
