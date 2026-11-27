import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'

const read=path=>readFileSync(fileURLToPath(new URL(path,import.meta.url)),'utf8')
const app=read('./App.jsx')
const css=read('./styles.css')
test('CDO canvas view gets layout class without changing editor layout',()=>{
  assert.match(app,/view === 'canvas' \? 'canvas-main-content' : ''/)
})
test('canvas grows to remaining browser height and honors small-screen minimum',()=>{
  assert.match(css,/\.canvas-main-content\{display:flex;flex-direction:column/)
  assert.match(css,/min-height:calc\(100dvh - 70px\)/)
  assert.match(css,/\.canvas-main-content>\.graph-area\{display:flex;flex:1 1 auto/)
  assert.match(css,/\.canvas-main-content>\.graph-area>\.lineage-wrapper\{flex:1;min-height:400px;height:auto/)
  assert.match(css,/min-height:calc\(100dvh - 60px\)/)
})
