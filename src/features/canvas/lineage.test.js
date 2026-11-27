import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createLineageLayout, lineageEdges, lineageEdgesFromRects,
  boundArrowBetween, NODE_HEIGHT,
} from './lineage.js'

const sample = [
  {id:'all',name:'cdo.all',version:1},
  {id:'position',name:'cdo.position',version:1,uses:{name:'cdo.all',version:1}},
  {id:'counterparty',name:'cdo.counterparty',version:1,uses:{name:'cdo.all',version:1}},
]
const rect = (left,top,width=202,height=150)=>({left,top,width,height,bottom:top+height,right:left+width})
const near = (actual,expected,tolerance=0.01)=>assert.ok(Math.abs(actual-expected)<tolerance,`Expected ${actual} ≈ ${expected}`)

test('child contracts appear below parents without overlapping siblings',()=>{
  const {positions,width}=createLineageLayout(sample)
  assert.ok(width>=680)
  assert.ok(positions.position.y>positions.all.y+NODE_HEIGHT)
  assert.equal(positions.position.y,positions.counterparty.y)
  assert.notEqual(positions.position.x,positions.counterparty.x)
})

test('each connector is bound to the exact parent contract version',()=>{
  const contracts=[
    {id:'all-v1',name:'cdo.all',version:1},
    {id:'all-v2',name:'cdo.all',version:2},
    {id:'position-v1',name:'cdo.position',version:1,uses:{name:'cdo.all',version:1}},
    {id:'counterparty-v1',name:'cdo.counterparty',version:1,uses:{name:'cdo.all',version:1}},
  ]
  const positions={
    'all-v1':{x:50,y:50},'all-v2':{x:900,y:50},
    'position-v1':{x:700,y:450},'counterparty-v1':{x:420,y:450},
  }
  const edges=lineageEdges(contracts,positions)
  assert.deepEqual(edges.map(e=>e.id),['all-v1->position-v1','all-v1->counterparty-v1'])
  assert.ok(edges.every(e=>e.from==='all-v1'))
  assert.ok(edges.every(e=>e.path.includes(' L ')))
})

test('orphaned parents and cyclic drafts do not break layout',()=>{
  const drafts=[
    {id:'a',name:'a',version:1,uses:{name:'b',version:1}},
    {id:'b',name:'b',version:1,uses:{name:'a',version:1}},
    {id:'missing',name:'m',version:1,uses:{name:'unknown',version:1}},
  ]
  const {positions}=createLineageLayout(drafts)
  assert.equal(Object.keys(positions).length,3)
  assert.ok(lineageEdges(drafts,positions).length<=2)
})

test('missing pinned parent version never connects to another version',()=>{
  const contracts=[
    {id:'all-v2',name:'cdo.all',version:2},
    {id:'child',name:'cdo.position',version:1,uses:{name:'cdo.all',version:1}},
  ]
  const {positions}=createLineageLayout(contracts)
  assert.equal(lineageEdges(contracts,positions).length,0)
  assert.equal(positions.child.y,positions['all-v2'].y)
})

test('Excalidraw-style: child to the right attaches right-to-left, not bottom-to-top',()=>{
  // Screenshot reproduction: parent at far left, both children lower/right.
  const a=rect(65,250,202,150), b=rect(660,440,202,150)
  const arrow=boundArrowBetween(a,b)
  assert.equal(arrow.fromSide,'right')
  assert.equal(arrow.toSide,'left')
  near(arrow.start.x,a.right+3)
  near(arrow.end.x,b.left-9)
  assert.ok(arrow.start.y>a.top && arrow.start.y<a.bottom)
  assert.ok(arrow.end.y>b.top && arrow.end.y<b.bottom)
  assert.match(arrow.path,/^M .* L .*$/)
  assert.doesNotMatch(arrow.path,/ C | H | V /)
})

test('child directly below parent uses bottom-to-top anchors',()=>{
  const a=rect(300,80), b=rect(300,440)
  const arrow=boundArrowBetween(a,b)
  assert.equal(arrow.fromSide,'bottom')
  assert.equal(arrow.toSide,'top')
  near(arrow.start.x,401)
  near(arrow.start.y,a.bottom+3)
  near(arrow.end.x,401)
  near(arrow.end.y,b.top-9)
})

test('child to left or above dynamically switches attachment edges',()=>{
  const right=rect(500,400)
  const left=rect(100,400)
  const towardLeft=boundArrowBetween(right,left)
  assert.equal(towardLeft.fromSide,'left')
  assert.equal(towardLeft.toSide,'right')
  const above=rect(500,40)
  const towardAbove=boundArrowBetween(right,above)
  assert.equal(towardAbove.fromSide,'top')
  assert.equal(towardAbove.toSide,'bottom')
})

test('diagonal attachments touch actual boundaries, not fixed card centers',()=>{
  const a=rect(100,100), b=rect(430,320)
  const arrow=boundArrowBetween(a,b)
  assert.equal(arrow.fromSide,'right')
  assert.equal(arrow.toSide,'left')
  assert.ok(arrow.start.y>175,'source anchor should shift toward child on edge')
  assert.ok(arrow.end.y<395,'target anchor should shift toward source on edge')
})

test('arrows use on-screen DOM rectangles after pan and zoom',()=>{
  const contracts=[
    {id:'v1',name:'cdo.all',version:1},
    {id:'v2',name:'cdo.all',version:2},
    {id:'child',name:'cdo.position',version:1,uses:{name:'cdo.all',version:1}},
  ]
  const viewport={left:300,top:100}
  const boxes={
    v1:rect(530,620,303,225), // 150% scale and panned origin
    v2:rect(1230,300,303,225),
    child:rect(955,800,303,225),
  }
  const edges=lineageEdgesFromRects(contracts,boxes,viewport)
  assert.equal(edges.length,1)
  assert.equal(edges[0].from,'v1')
  assert.equal(edges[0].to,'child')
  assert.equal(edges[0].fromSide,'right')
  assert.equal(edges[0].toSide,'left')
  near(edges[0].start.x,530-300+303+3)
  near(edges[0].end.x,955-300-9)
  // Coordinates are viewport-local, not absolute clientX/clientY.
  assert.ok(edges[0].start.y<800-100)
})

test('dragging a parent changes its endpoint immediately; no stale cached path',()=>{
  const contracts=[
    {id:'root',name:'cdo.all',version:1},
    {id:'child',name:'cdo.counterparty',version:1,uses:{name:'cdo.all',version:1}},
  ]
  const viewport={left:0,top:0}
  const boxes={root:rect(20,50),child:rect(500,280)}
  const before=lineageEdgesFromRects(contracts,boxes,viewport)[0]
  boxes.root=rect(800,350)
  const after=lineageEdgesFromRects(contracts,boxes,viewport)[0]
  assert.notEqual(after.path,before.path)
  assert.equal(before.fromSide,'right')
  assert.equal(after.fromSide,'left')
  assert.equal(after.toSide,'right')
})

test('arrows are not drawn backward through physically overlapping shapes',()=>{
  assert.equal(boundArrowBetween(rect(100,100),rect(100,100)),null)
  assert.equal(boundArrowBetween(rect(100,100),rect(155,100)),null)
})

test('invalid shapes are ignored rather than producing NaN SVG paths',()=>{
  assert.equal(boundArrowBetween({left:0,top:0,width:0,height:150},rect(400,300)),null)
})
