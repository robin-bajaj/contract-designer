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
  assert.match(workspace,/Team Lead: Manage connections/)
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
test('team workspace opens discovered Git files in read-only project explorer',()=>{
  const tree=read('./ProjectFileTree.jsx')
  assert.match(workspace,/teamConnectedModels\(role\)/)
  assert.match(workspace,/teamConnectedFile\(role,path\)/)
  assert.match(workspace,/<ProjectFileTree paths=\{discoveredFiles\}/)
  assert.match(workspace,/read-only/)
  assert.match(tree,/onOpen\(file.path\)/)
  assert.match(tree,/FileJson|FileCode2/)
})

test('GitHub fine-grained token is submitted to backend and cleared after success',()=>{
  const api=read('../../services/portal/projectConnectionApi.js')
  const backend=read('../../../server/project_connections.py')
  assert.match(admin,/GitHub fine-grained personal access token/)
  assert.match(admin,/setGithubToken\(''\)/)
  assert.match(api,/leadConnectGithubToken/)
  assert.match(backend,/connect_github_token/)
  assert.doesNotMatch(admin,/localStorage|sessionStorage|document\.cookie/)
})
