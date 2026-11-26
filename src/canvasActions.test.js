import test from 'node:test'
import assert from 'node:assert/strict'
import { canvasTapAction, positionCanvasMenu } from './canvasActions.js'

test('plain canvas click offers standalone contract creation', () => {
  assert.equal(canvasTapAction('pan', false), 'create-standalone-menu')
})
test('dragging to pan or reposition never opens a creation menu', () => {
  assert.equal(canvasTapAction('pan', true), 'none')
  assert.equal(canvasTapAction('node', true, { uses: null }), 'none')
})
test('clicking standalone contract offers view and child creation choices', () => {
  assert.equal(canvasTapAction('node', false, { id:'all', uses: null }), 'contract-menu')
})
test('clicking a child contract opens its editor directly', () => {
  assert.equal(canvasTapAction('node', false, { id:'position', uses:{name:'cdo.all',version:1} }), 'view')
})
test('context menus are constrained to canvas edges', () => {
  const rect = {left:100,top:100,width:800,height:450}
  assert.deepEqual(positionCanvasMenu(110,105,rect),{x:10,y:8})
  assert.deepEqual(positionCanvasMenu(1000,800,rect,232,145),{x:560,y:297})
})
