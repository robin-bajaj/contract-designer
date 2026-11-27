import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'

const read=path=>readFileSync(fileURLToPath(new URL(path,import.meta.url)),'utf8')
const editor=read('./TeamModelEditor.jsx')
const status=read('./LiveStagingStatus.jsx')

test('CDO inheritance is selectable and feeds the generated YAML',()=>{
  assert.match(editor,/Inherit a versioned contract/)
  assert.match(editor,/availableContracts\(contracts\)/)
  assert.match(editor,/setContract\(e\.target\.value\)/)
  assert.match(editor,/Inherited attributes/)
  assert.match(editor,/Inherited metrics/)
})

test('staging placeholder does not suggest a nonexistent dbt ref',()=>{
  assert.match(editor,/150\.25::numeric as profit_loss/)
  assert.match(editor,/current_date as report_date/)
  assert.doesNotMatch(editor,/placeholder=\{\`select.*ref\(/s)
  assert.match(editor,/only for a model already published in this portal/)
})

test('both full-model and live status display actionable errors',()=>{
  assert.match(editor,/validationResult\.hint/)
  assert.match(status,/hint:response\.hint/)
  assert.match(status,/current\?\.hint/)
})
