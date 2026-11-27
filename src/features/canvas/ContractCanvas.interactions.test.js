import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const source = readFileSync(fileURLToPath(new URL('./ContractCanvas.jsx', import.meta.url)), 'utf8')

test('canvas offers identical actions on right-click and contract double-click', () => {
  assert.match(source, /onContextMenu=\{e => openContext\(e, 'node', c\)\}/)
  assert.match(source, /onDoubleClick=\{e => openDoubleClick\(e, c\)\}/)
  assert.match(source, /showMenu\('contract', contract, event\.clientX, event\.clientY\)/)
  assert.match(source, /View Contract/)
  assert.match(source, /Create Child Contract/)
})

test('Escape dismisses contextual menu and cancels active pointer interaction', () => {
  assert.match(source, /event\.key !== 'Escape'/)
  assert.match(source, /interaction\.current = null/)
  assert.match(source, /setContextMenu\(null\)/)
  assert.match(source, /releasePointerCapture/)
})

test('accessible keyboard context-menu shortcut remains supported', () => {
  assert.match(source, /event\.key !== 'ContextMenu'/)
  assert.match(source, /event\.shiftKey && event\.key === 'F10'/)
})
