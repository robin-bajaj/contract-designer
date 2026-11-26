import test from 'node:test'
import assert from 'node:assert/strict'
import { canvasContextAction, positionCanvasMenu } from './canvasActions.js'

test('right-clicking plain canvas offers standalone contract creation', () => {
  assert.equal(canvasContextAction('pan'), 'create-standalone-menu')
})
test('right-clicking standalone contract offers view and create-child choices', () => {
  assert.equal(canvasContextAction('node', { id:'all', uses: null }), 'contract-menu')
})
test('right-clicking child also offers contract actions', () => {
  assert.equal(canvasContextAction('node', { id:'position', uses:{name:'cdo.all',version:1} }), 'contract-menu')
})
test('unrecognized target does not trigger a context action', () => {
  assert.equal(canvasContextAction('node'), 'none')
  assert.equal(canvasContextAction('toolbar'), 'none')
})
test('context menus are constrained to canvas edges', () => {
  const rect = {left:100,top:100,width:800,height:450}
  assert.deepEqual(positionCanvasMenu(110,105,rect),{x:10,y:8})
  assert.deepEqual(positionCanvasMenu(1000,800,rect,232,145),{x:560,y:297})
})
