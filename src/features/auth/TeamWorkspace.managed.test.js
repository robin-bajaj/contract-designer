import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'

const read=path=>readFileSync(fileURLToPath(new URL(path,import.meta.url)),'utf8')
const dashboard=read('./TeamWorkspace.jsx')
const editor=read('./TeamModelEditor.jsx')
const staging=read('./LiveStagingStatus.jsx')

test('Team A/C dashboard uses connected project explorer without configuration paths',()=>{
  assert.match(dashboard,/CONNECTED DBT PROJECT/)
  assert.match(dashboard,/dbt-studio-sidebar/)
  assert.match(dashboard,/dbt-studio-main/)
  assert.match(dashboard,/read-only/)
  assert.doesNotMatch(dashboard,/Portal models and drafts/)
  assert.doesNotMatch(dashboard,/DBT_PROJECT_PATH|dbt project:|dbt Cloud Admin:/)
})

test('staging and semantic model authoring does not ask team users to configure dbt',()=>{
  assert.match(editor,/1\. Staging model/)
  assert.match(editor,/Save Draft/)
  assert.match(editor,/Validate Model/)
  assert.match(editor,/Create GitHub PR/)
  assert.doesNotMatch(editor,/DBT_PROJECT_PATH|configured dbt project|Publish to dbt Project/)
})

test('live model checks are honest about scope without exposing engine details',()=>{
  assert.match(staging,/Staging checks passed/)
  assert.match(staging,/SQL execution and column types/)
  assert.doesNotMatch(staging,/Unable to check dbt Core/)
})
