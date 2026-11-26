import test from 'node:test'
import assert from 'node:assert/strict'
import { ROLES, ROLE_OPTIONS, isKnownRole, canAccessDesigner } from './roles.js'

test('demo login exposes exactly three distinct roles', () => {
  assert.deepEqual(ROLE_OPTIONS.map(role => role.id), [ROLES.CDO, ROLES.TEAM_A, ROLES.TEAM_C])
  assert.equal(new Set(ROLE_OPTIONS.map(role => role.id)).size, 3)
})
test('only CDO is routed to the contract designer', () => {
  assert.equal(canAccessDesigner(ROLES.CDO), true)
  assert.equal(canAccessDesigner(ROLES.TEAM_A), false)
  assert.equal(canAccessDesigner(ROLES.TEAM_C), false)
  assert.equal(isKnownRole('admin'), false)
  assert.equal(isKnownRole(null), false)
})
