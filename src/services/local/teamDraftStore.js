import { teamFolder } from '../github/teamSemanticRegistry.js'

/** Team-specific browser drafts. No network requests or GitHub credentials. */
const PREFIX = 'contract-designer.local-team-drafts.v1'
const MAX_DRAFTS = 100

export function teamDraftStorageKey(role) {
  return `${PREFIX}.${teamFolder(role)}`
}

function browserStorage() {
  if (typeof window === 'undefined') return null
  try { return window.localStorage } catch { return null }
}

export function loadTeamDrafts(role, storage = browserStorage()) {
  const key = teamDraftStorageKey(role)
  if (!storage) return []
  try {
    const decoded = JSON.parse(storage.getItem(key) || '[]')
    if (!Array.isArray(decoded)) return []
    return decoded.filter(item =>
      item && typeof item.id === 'string' &&
      typeof item.savedAt === 'string' &&
      item.draft && typeof item.draft === 'object' &&
      !Array.isArray(item.draft),
    ).slice(0, MAX_DRAFTS)
  } catch {
    return []
  }
}

export function saveTeamDraft(role, draft, storage = browserStorage()) {
  if (!storage) throw Error('Browser draft storage is unavailable. Download SQL/YAML instead.')
  const team = teamFolder(role)
  if (!draft || typeof draft !== 'object') throw Error('Invalid team draft')
  const id = `${team}:${String(draft.semanticName || draft.sourceModel || 'untitled').trim()}`
  const saved = { id, savedAt: new Date().toISOString(), draft: JSON.parse(JSON.stringify(draft)) }
  const previous = loadTeamDrafts(role, storage)
  const next = [saved, ...previous.filter(item => item.id !== id)].slice(0, MAX_DRAFTS)
  try { storage.setItem(teamDraftStorageKey(role), JSON.stringify(next)) }
  catch { throw Error('Could not save draft in this browser. Download a copy instead.') }
  return saved
}

export function deleteTeamDraft(role, id, storage = browserStorage()) {
  if (!storage) throw Error('Browser draft storage is unavailable')
  const next = loadTeamDrafts(role, storage).filter(item => item.id !== id)
  storage.setItem(teamDraftStorageKey(role), JSON.stringify(next))
  return next
}
