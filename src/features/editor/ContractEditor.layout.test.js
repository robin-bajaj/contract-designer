import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'

const read=path=>readFileSync(fileURLToPath(new URL(path,import.meta.url)),'utf8')
const editor=read('./ContractEditor.jsx')
const css=read('../../styles.css')
const app=read('../../App.jsx')

test('CDO YAML stays live and is rendered beside rather than inside the contract form',()=>{
  assert.match(editor,/className=\{`editor-split-layout \$\{showYaml \? 'has-yaml' : ''\}\`\}/)
  assert.match(editor,/<div className="editor-panel">/)
  assert.match(editor,/<\/div>\s*\{showYaml && <aside className="yaml-preview yaml-side-panel"/)
  assert.match(editor,/<code>\{selectedYaml\}<\/code>/)
  assert.match(editor,/ref=\{yamlRef\}/)
  assert.match(app,/const selectedYaml = active \? toYaml\(active\) : ''/)
})

test('sticky desktop panel scrolls YAML independently, and narrow workspace stacks',()=>{
  assert.match(css,/@container \(min-width: 1040px\)/)
  assert.match(css,/\.editor-split-layout\.has-yaml\{/)
  assert.match(css,/grid-template-columns:minmax\(0,1\.5fr\) minmax\(360px,0\.95fr\)/)
  assert.match(css,/position:sticky/)
  assert.match(css,/\.editor-split-layout\.has-yaml>\.yaml-side-panel pre\{/)
  assert.match(css,/overflow:auto/)
  assert.match(css,/\.main-content\{container-type:inline-size\}/)
})

test('View YAML does not scroll page when preview is visible side by side',()=>{
  assert.match(editor,/getComputedStyle\(preview\.parentElement\)\.display !== 'grid'/)
  assert.match(editor,/scrollIntoView\(\{behavior:'smooth',block:'start'\}\)/)
  assert.match(editor,/aria-label="Hide YAML preview"/)
  assert.match(editor,/Copy YAML/)
  assert.match(editor,/Download \.yml/)
})
