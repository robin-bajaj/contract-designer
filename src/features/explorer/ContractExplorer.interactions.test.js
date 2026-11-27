import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const source=readFileSync(fileURLToPath(new URL('./ContractExplorer.jsx',import.meta.url)),'utf8')

test('tree nodes open action menu on double-click and right-click',()=>{
  assert.match(source,/onDoubleClick=\{event =>/)
  assert.match(source,/onContextMenu=\{event =>/)
  assert.match(source,/onClick=\{\(\) => setMenuId/)
  assert.match(source,/menuId === contract\.id && <div/)
})
test('Escape dismisses tree context actions',()=>{
  assert.match(source,/event\.key === 'Escape'/)
  assert.match(source,/setMenuId\(null\)/)
})
