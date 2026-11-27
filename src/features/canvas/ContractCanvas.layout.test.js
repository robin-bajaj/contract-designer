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

test('toolbar uses immediate custom hover labels and no delayed native title tooltips',()=>{
  for(const hint of [
    'Zoom out · reduce scale',
    'Zoom in · increase scale',
    'Fit all contracts · centers and scales the view',
    'Reset zoom to 100% · keep card layout',
    'Restore automatic card positions · changes layout',
    'Current zoom level',
  ]) assert.ok(canvas.includes(`data-tooltip="${hint}"`), `Missing tooltip: ${hint}`)
  assert.doesNotMatch(canvas,/title="Reset card positions and zoom to 100%"/)
  const css=read('../../styles.css')
  assert.match(css,/\.canvas-toolbar \[data-tooltip\]:hover::after/)
  assert.match(css,/\.canvas-toolbar \[data-tooltip\]:focus-visible::after/)
  assert.match(css,/pointer-events:none/)
})

test('zoom reset does not restore card positions',()=>{
  assert.match(canvas,/const resetZoom = \(\) => setView\(/)
  const start=canvas.indexOf('const resetZoom =')
  const end=canvas.indexOf('const restoreLayout =',start)
  const zoomImplementation=canvas.slice(start,end)
  assert.doesNotMatch(zoomImplementation,/setOverrides|removeItem/)
  assert.match(canvas,/onClick=\{resetZoom\}/)
  assert.match(canvas,/onClick=\{restoreLayout\}/)
})
