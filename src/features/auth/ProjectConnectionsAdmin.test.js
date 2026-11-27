import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'

const read=path=>readFileSync(fileURLToPath(new URL(path,import.meta.url)),'utf8')
const gateway=read('./RoleGateway.jsx')
const admin=read('./ProjectConnectionsAdmin.jsx')
const workspace=read('./TeamWorkspace.jsx')
const backend=read('../../../server/fast_validate.py')

test('only CDO-facing navigation exposes the connection wizard; backend enforces key',()=>{
  assert.match(gateway,/canAccessDesigner\(role\)/)
  assert.match(gateway,/ProjectConnectionsAdmin/)
  assert.match(gateway,/Project connections/)
  assert.match(admin,/Portal administrator key/)
  assert.match(admin,/type="password"/)
  assert.match(backend,/project_connections\.require_admin\(self\.headers\.get\("X-Portal-Admin-Key"\)\)/)
})
test('team workspace discovers connected models and read-only source SQL and YAML',()=>{
  assert.match(workspace,/teamConnectedModels\(role\)/)
  assert.match(workspace,/teamConnectedFile\(role,path\)/)
  assert.match(workspace,/Connected dbt project/)
  assert.match(workspace,/View source YAML/)
  assert.match(workspace,/View source SQL/)
  assert.match(workspace,/read-only/)
})
test('dbt API and GitHub tokens are not entered into the React wizard',()=>{
  assert.doesNotMatch(admin,/input.*DBT_CLOUD_TOKEN/)
  assert.doesNotMatch(admin,/input.*PORTAL_GITHUB_READ_TOKEN/)
  assert.match(admin,/credentials remain in dbt Cloud/)
})
