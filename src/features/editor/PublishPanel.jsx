import React from 'react'
import { GitBranch } from 'lucide-react'
import { GOVERNANCE_REPO, registryFilename } from '../../services/github/githubPublish.js'

/** Publishing proposes a review PR; never commits directly to governance main. */
export default function PublishPanel({ contract, token, onTokenChange, onPublish, isPublishing, pullRequest }) {
  const validIdentity = /^[a-z][a-z0-9_.]*$/.test(contract.name) &&
    Number.isSafeInteger(Number(contract.version)) && Number(contract.version) > 0
  const path = validIdentity ? registryFilename(contract) : 'Complete a valid contract name/version first'

  return <section className="github-publish-panel" aria-label="GitHub publishing">
    <div>
      <strong>Save to GitHub for review</strong>
      <p className="muted">Target repository: {GOVERNANCE_REPO}. Path: {path}. Creates a new branch and pull request; never writes directly to main or overwrites a released contract version. Unpublished editor changes are temporary; export YAML for backup.</p>
    </div>
    <div className="github-publish-controls">
      <input type="password" autoComplete="off" value={token} onChange={e => onTokenChange(e.target.value)}
        placeholder="GitHub fine-grained token (not stored)" aria-label="GitHub access token"/>
      <button className="primary" onClick={onPublish} disabled={isPublishing || !token.trim() || !validIdentity}>
        <GitBranch size={16}/>{isPublishing ? 'Creating PR...' : 'Save to GitHub (PR)'}
      </button>
    </div>
    <small className="muted">Token needs Contents: Read/Write and Pull requests: Read/Write on cdo-semantic-governance. Token stays in page memory and is not saved in localStorage.</small>
    {pullRequest && <p><a href={pullRequest.url} target="_blank" rel="noopener noreferrer">Open pull request #{pullRequest.number}</a></p>}
  </section>
}
