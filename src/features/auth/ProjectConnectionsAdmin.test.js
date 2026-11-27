import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'

const read=path=>readFileSync(fileURLToPath(new URL(path,import.meta.url)),'utf8')
const admin=read('./ProjectConnectionsAdmin.jsx')
const workspace=read('./TeamWorkspace.jsx')
const backend=read('../../../server/fast_validate.py')

test('Team A/C members configure dbt inside workspace without a lead code',()=>{
  assert.match(workspace,/setConnecting\(true\)/)
  assert.match(workspace,/Team Lead: Connect dbt Project/)
  assert.match(workspace,/ProjectConnectionsAdmin role=\{role\}/)
  assert.match(admin,/dbt Cloud account ID/)
  assert.match(admin,/dbt Cloud service token/)
  assert.match(admin,/dbt Cloud API host/)
  assert.doesNotMatch(backend,/X-Portal-Lead-Key/)
  assert.match(backend,/local_onboarding_request_allowed/)
  assert.doesNotMatch(admin,/Lead access code/)
})
test('service token is erased after save and never stored in browser storage',()=>{
  assert.match(admin,/setServiceToken\(''\)/)
  assert.doesNotMatch(admin,/localStorage|sessionStorage|document\.cookie/)
})
test('team workspace still displays existing Git SQL and YAML read-only',()=>{
  assert.match(workspace,/teamConnectedModels\(role\)/)
  assert.match(workspace,/teamConnectedFile\(role,path\)/)
  assert.match(workspace,/View source YAML/)
  assert.match(workspace,/View source SQL/)
})
