import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'

const read=path=>readFileSync(fileURLToPath(new URL(path,import.meta.url)),'utf8')
const editor=read('./TeamModelEditor.jsx')
const css=read('./TeamModelEditor.css')

test('Team A/C authoring has separate form and live YAML side panel',()=>{
  assert.match(editor,/className="team-editor-form team-editor-split-layout"/)
  assert.match(editor,/className="team-editor-fields"/)
  assert.match(editor,/<\/div>\s*<aside className="team-yaml-preview"/)
  assert.match(editor,/<pre aria-label="Generated dbt YAML content">\{generated/)
  assert.match(editor,/generated=useMemo\(/)
  assert.match(editor,/buildTeamModelDocument\(draft,role,contracts,sourceModels\)/)
})

test('team preview retains copy and download actions',()=>{
  assert.match(editor,/navigator\.clipboard\?\.writeText\(generated\)/)
  assert.match(editor,/downloadYaml\(`\$\{draft\.semanticName\}\.yml`,generated\)/)
  assert.match(editor,/disabled=\{!generated\}/)
})

test('team YAML right column stays visible and scrollable on desktop, stacks below on mobile',()=>{
  assert.match(css,/@media\(min-width:1320px\)/)
  assert.match(css,/\.team-editor-split-layout\{/)
  assert.match(css,/grid-template-columns:minmax\(0,1\.45fr\) minmax\(370px,0\.95fr\)/)
  assert.match(css,/\.team-editor-split-layout>\.team-yaml-preview\{/)
  assert.match(css,/position:sticky/)
  assert.match(css,/\.team-editor-split-layout>\.team-yaml-preview pre\{/)
  assert.match(css,/max-height:420px/)
})

test('team editing UI uses compact controls and a smaller sticky preview',()=>{
  assert.match(css,/\.team-editor\{padding:20px 22px 48px\}/)
  assert.match(css,/\.team-editor-fields>section\{padding:16px 18px/)
  assert.match(css,/\.team-editor-fields h3\{font-size:15px/)
  assert.match(css,/height:min\(68dvh,690px\)/)
  assert.match(css,/min-height:34px/)
})
