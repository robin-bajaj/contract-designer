/** Demo-only role identities. These are not authenticated user accounts. */
export const ROLES = Object.freeze({
  CDO: 'cdo',
  TEAM_A: 'team-a',
  TEAM_C: 'team-c',
})

export const ROLE_OPTIONS = Object.freeze([
  { id: ROLES.CDO, label: 'CDO', description: 'Central Data Office · Govern enterprise contracts' },
  { id: ROLES.TEAM_A, label: 'Team A', description: 'Equities · Team semantic models' },
  { id: ROLES.TEAM_C, label: 'Team C', description: 'Fixed Income · Team semantic models' },
])

export const isKnownRole = role => ROLE_OPTIONS.some(option => option.id === role)
export const canAccessDesigner = role => role === ROLES.CDO
