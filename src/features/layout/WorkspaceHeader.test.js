import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ROLE_OPTIONS } from '../auth/roles.js'

const read = path => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const gateway = read('../auth/RoleGateway.jsx')
const designer = read('../../App.jsx')
const teams = read('../auth/TeamWorkspace.jsx')
const header = read('./WorkspaceHeader.jsx')

test('one shared workspace header is rendered before every registered role workspace', () => {
  assert.equal(ROLE_OPTIONS.length, 3)
  assert.match(gateway, /<WorkspaceHeader\s+role=\{role\}\s+roleOptions=\{roleOptions\}\s+onLogout=\{signOut\}/)
  assert.match(gateway, /canAccessDesigner\(role\)\s*\?\s*<ContractDesigner\s*\/>/)
  assert.match(gateway, /:\s*<TeamWorkspace/)
  assert.doesNotMatch(designer, /<header\b/)
  assert.doesNotMatch(teams, /<header\b/)
})

test('shared header has a role indicator and a working sign out callback', () => {
  assert.match(header, /roleOptions\.find\(/)
  assert.match(header, /currentRole\?\.label/)
  assert.match(header, /onClick=\{onLogout\}/)
  assert.match(header, /SEMANTIC GOVERNANCE/)\n  assert.match(gateway, /fetch\(\x27\/api\/teams\x27\)/)
})
