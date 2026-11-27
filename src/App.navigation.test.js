import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
const read=path=>readFileSync(fileURLToPath(new URL(path,import.meta.url)),'utf8')
const app=read('./App.jsx')
const css=read('./styles.css')

test('CDO sidebar collapse and expansion keeps a visible toggle',()=>{
  assert.match(app,/sidebarCollapsed, setSidebarCollapsed/)
  assert.match(app,/sidebar-toggle/)
  assert.match(app,/aria-label=\{sidebarCollapsed \? 'Expand contract explorer' : 'Collapse contract explorer'\}/)
  assert.match(css,/\.workspace-sidebar-collapsed \.sidebar\{width:62px/)
})
test('Escape exits the editor without interrupting typed fields',()=>{
  assert.match(app,/event\.key !== 'Escape'/)
  assert.match(app,/event\.target\.blur\(\)/)
  assert.match(app,/setView\('canvas'\)/)
})
