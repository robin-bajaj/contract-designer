import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
const read = path => readFileSync(fileURLToPath(new URL(path, import.meta.url)),'utf8')
const workspace = read('./TeamWorkspace.jsx')
const editor = read('./TeamModelEditor.jsx')

test('Team A/C workspace does not discover or sync with federated dbt repo',()=>{
  assert.doesNotMatch(workspace,/fetchTeamSemanticModels|fetchTeamSourceModels|FEDERATED_REPO/)
  assert.doesNotMatch(editor,/publishTeamModelPR|fastValidateTeamModel|LiveStagingStatus/)
  assert.doesNotMatch(workspace,/Refresh from GitHub|View authored YAML in GitHub/)
  assert.doesNotMatch(editor,/Save to GitHub \(PR\)|fine-grained GitHub token/)
})

test('CDO contract registry remains available read-only for inheritance selection',()=>{
  assert.match(workspace,/fetchGovernanceContracts\(\)/)
  assert.match(workspace,/Refresh CDO Contracts/)
  assert.match(editor,/availableContracts\(contracts\)/)
  assert.match(editor,/chooseContract\(current,key,contracts\)/)
})

test('local authoring offers save, reopen, SQL download and YAML download',()=>{
  assert.match(workspace,/loadTeamDrafts\(role\)/)
  assert.match(workspace,/saveTeamDraft\(role, draft\)/)
  assert.match(workspace,/initialDraft=\{editing\?\.draft\}/)
  assert.match(editor,/onSave\(draft\)/)
  assert.match(editor,/Save local draft/)
  assert.match(editor,/Download SQL/)
  assert.match(editor,/Download YAML/)
})
