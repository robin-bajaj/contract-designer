import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'

const read=path=>readFileSync(fileURLToPath(new URL(path,import.meta.url)),'utf8')
const canvas=read('./ContractCanvas.jsx')
const app=read('../../App.jsx')
const css=read('../../styles.css')

test('canvas defaults to 100 percent and one center control does not move cards',()=>{
  assert.match(canvas,/const \[view, setView\] = useState\(\{ x: 0, y: 0, scale: 1 \}\)/)
  assert.match(canvas,/useEffect\(\(\) => \{ centerAt\(1\) \}, \[ids\]\)/)
  assert.match(canvas,/onClick=\{\(\) => centerAt\(1\)\}/)
  assert.doesNotMatch(canvas,/onClick=\{fit\}|onClick=\{restoreLayout\}|onClick=\{resetZoom\}/)
  assert.match(canvas,/aria-label="Center canvas at 100%"/)
})

test('toolbar retains only minus, plus and one center control',()=>{
  assert.match(canvas,/<Minus size=\{17\}/)
  assert.match(canvas,/<Plus size=\{17\}/)
  assert.match(canvas,/<Focus size=\{16\}/)
  assert.doesNotMatch(canvas,/Maximize2|RotateCcw|LayoutGrid/)
})

test('one concise instruction appears only in canvas toolbar',()=>{
  assert.match(canvas,/className="canvas-hint"/)
  assert.doesNotMatch(canvas,/className="canvas-mode"/)
  assert.doesNotMatch(app,/Left-drag the canvas to pan or move contracts/)
})

test('toolbar help appears immediately on hover and focus',()=>{
  for(const hint of [
    'Zoom out · reduce scale',
    'Zoom in · increase scale',
    'Center canvas at 100% · preserves card positions',
    'Current zoom level',
  ]) assert.ok(canvas.includes(`data-tooltip="${hint}"`), `Missing tooltip: ${hint}`)
  assert.match(css,/\.canvas-toolbar \[data-tooltip\]:hover::after/)
  assert.match(css,/\.canvas-toolbar \[data-tooltip\]:focus-visible::after/)
})

test('arrows use measured card rectangles in viewport space, not canvas world transform',()=>{
  assert.match(canvas,/lineageEdgesFromRects\(contracts, cardRects, rect\)/)
  assert.match(canvas,/cardRefs\.current\.get\(c\.id\)\?\.getBoundingClientRect\(\)/)
  assert.match(canvas,/className="canvas-connections-overlay"/)
  assert.match(canvas,/useLayoutEffect\(\(\) => \{ measureEdges\(\) \}/)
  assert.match(css,/\.canvas-connections-overlay\{position:absolute;inset:0;width:100%;height:100%/)
})
