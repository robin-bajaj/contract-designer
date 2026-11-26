import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'

const source=readFileSync(fileURLToPath(new URL('./LiveStagingStatus.jsx',import.meta.url)),'utf8')
const editor=readFileSync(fileURLToPath(new URL('./TeamModelEditor.jsx',import.meta.url)),'utf8')
test('SQL editor mounts live validation without requiring semantic fields',()=>{
  assert.match(editor,/<LiveStagingStatus role=\{role\} sourceModel=\{draft\.sourceModel\} sourceSql=\{draft\.sourceSql\}/)
})
test('live validation is debounced and old requests are cancelled',()=>{
  assert.match(source,/setTimeout\(/)
  assert.match(source,/controller\.abort\(\)/)
  assert.match(source,/controller\.signal\.aborted/)
  assert.match(source,/result\?\.signature===signature/)
})
test('feedback shows check and cross but does not claim SQL execution',()=>{
  assert.match(source,/CheckCircle2/)
  assert.match(source,/XCircle/)
  assert.match(source,/SQL execution and column types/)
})
