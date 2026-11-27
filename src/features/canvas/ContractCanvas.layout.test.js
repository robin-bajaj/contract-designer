import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'

const read=path=>readFileSync(fileURLToPath(new URL(path,import.meta.url)),'utf8')
const canvas=read('./ContractCanvas.jsx')
const app=read('../../App.jsx')

test('the canvas starts at 100% and only fits when requested',()=>{
  assert.match(canvas,/const \[view, setView\] = useState\(\{ x: 0, y: 0, scale: 1 \}\)/)
  assert.match(canvas,/useEffect\(\(\) => \{ centerAt\(1\) \}, \[ids\]\)/)
  assert.match(canvas,/onClick=\{fit\}/)
  assert.match(canvas,/scale:1\}\)/)
})

test('one concise instruction appears in the canvas toolbar, not outside or at the bottom',()=>{
  assert.match(canvas,/className="canvas-hint"/)
  assert.doesNotMatch(canvas,/className="canvas-mode"/)
  assert.doesNotMatch(app,/Left-drag the canvas to pan or move contracts/)
})

test('canvas controls describe their functions on hover',()=>{
  for(const hint of [
    'Zoom out (decrease canvas scale)',
    'Zoom in (increase canvas scale)',
    'Fit all contracts into view',
    'Reset card positions and zoom to 100%',
    'Current canvas zoom level',
  ]) assert.ok(canvas.includes(`title="${hint}"`),`Expected tooltip: ${hint}`)
})
