import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Maximize2, Minus, Plus, RotateCcw, Move, Eye, GitBranch } from 'lucide-react'
import { canvasContextAction, positionCanvasMenu } from './canvasActions.js'
import { createLineageLayout, lineageEdges, NODE_WIDTH, NODE_HEIGHT } from './lineage.js'

const MIN_SCALE = 0.4
const MAX_SCALE = 2
const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value))
const STORAGE_KEY = 'contract-designer.canvas-layout.v1'

function readPositions() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {} }
  catch { return {} }
}

/** Interactive lineage canvas; changes to positions never affect exported contract YAML. */
export default function ContractCanvas({ contracts, onOpen, onCreateStandalone, onCreateChild }) {
  const viewport = useRef(null)
  const interaction = useRef(null)
  const [overrides, setOverrides] = useState(readPositions)
  const [contextMenu, setContextMenu] = useState(null)
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 })
  const auto = useMemo(() => createLineageLayout(contracts), [contracts])
  const positions = useMemo(() => {
    const result = { ...auto.positions }
    for (const c of contracts) {
      const saved = overrides[c.id]
      if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) result[c.id] = saved
    }
    return result
  }, [auto, overrides, contracts])
  const edges = useMemo(() => lineageEdges(contracts, positions), [contracts, positions])
  const bounds = useMemo(() => ({
    width: Math.max(auto.width, ...Object.values(positions).map(p => p.x + NODE_WIDTH + 70)),
    height: Math.max(auto.height, ...Object.values(positions).map(p => p.y + NODE_HEIGHT + 70)),
  }), [auto, positions])

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides)) } catch { /* optional */ }
  }, [overrides])

  const centerAt = useCallback((scale = 1) => {
    if (!viewport.current) return
    const { width, height } = viewport.current.getBoundingClientRect()
    const pts = Object.values(positions)
    if (!pts.length) { setView({ x: 0, y: 0, scale }); return }
    const left = Math.min(...pts.map(p => p.x))
    const top = Math.min(...pts.map(p => p.y))
    const right = Math.max(...pts.map(p => p.x + NODE_WIDTH))
    const bottom = Math.max(...pts.map(p => p.y + NODE_HEIGHT))
    setView({
      x: (width - (left + right) * scale) / 2,
      y: (height - (top + bottom) * scale) / 2,
      scale,
    })
  }, [positions])
  const fit = useCallback(() => {
    if (!viewport.current) return
    const { width, height } = viewport.current.getBoundingClientRect()
    const pts = Object.values(positions)
    if (!pts.length) { centerAt(1); return }
    const left = Math.min(...pts.map(p => p.x))
    const top = Math.min(...pts.map(p => p.y))
    const right = Math.max(...pts.map(p => p.x + NODE_WIDTH))
    const bottom = Math.max(...pts.map(p => p.y + NODE_HEIGHT))
    const scale = clamp(Math.min((width - 80) / (right - left), (height - 80) / (bottom - top), 1.2), MIN_SCALE, MAX_SCALE)
    centerAt(scale)
  }, [positions, centerAt])

  // Default to true 100% zoom, centered on the graph, rather than auto-fit.
  // Fit is now explicitly requested through the expand-arrows toolbar button.
  const ids = contracts.map(c => c.id).join('|')
  useEffect(() => { centerAt(1) }, [ids]) // eslint-disable-line react-hooks/exhaustive-deps

  const zoomAt = (scaleFactor, x, y) => setView(v => {
    const scale = clamp(v.scale * scaleFactor, MIN_SCALE, MAX_SCALE)
    const ratio = scale / v.scale
    return { scale, x: x - (x - v.x) * ratio, y: y - (y - v.y) * ratio }
  })
  const showMenu = (kind, contract, clientX, clientY) => {
    const bounds = viewport.current?.getBoundingClientRect()
    if (!bounds) return
    setContextMenu({ kind, id: contract?.id || null, ...positionCanvasMenu(clientX, clientY, bounds, 232, kind === 'standalone' ? 68 : 145) })
  }
  const start = (event, kind, id = null) => {
    if (event.button !== 0 || !viewport.current) return
    if (kind === 'node') event.stopPropagation()
    setContextMenu(null)
    event.currentTarget.setPointerCapture(event.pointerId)
    interaction.current = {
      kind, id, pointerId: event.pointerId, x: event.clientX, y: event.clientY,
      moved: false, initial: kind === 'node' ? { ...positions[id] } : { ...view },
    }
  }
  const move = event => {
    const active = interaction.current
    if (!active || active.pointerId !== event.pointerId) return
    const dx = event.clientX - active.x
    const dy = event.clientY - active.y
    if (Math.hypot(dx, dy) > 4) active.moved = true
    if (!active.moved) return
    if (active.kind === 'node') {
      setOverrides(previous => ({ ...previous, [active.id]: {
        x: active.initial.x + dx / view.scale,
        y: active.initial.y + dy / view.scale,
      } }))
    } else {
      setView(previous => ({ ...previous, x: active.initial.x + dx, y: active.initial.y + dy }))
    }
  }
  const end = event => {
    const active = interaction.current
    if (!active || active.pointerId !== event.pointerId) return
    interaction.current = null
  }
  const openContext = (event, kind, contract = null) => {
    event.preventDefault()
    event.stopPropagation()
    interaction.current = null
    const action = canvasContextAction(kind, contract)
    if (action === 'contract-menu') showMenu('contract', contract, event.clientX, event.clientY)
    if (action === 'create-standalone-menu') showMenu('standalone', null, event.clientX, event.clientY)
  }
  const openDoubleClick = (event, contract) => {
    event.preventDefault()
    event.stopPropagation()
    interaction.current = null
    showMenu('contract', contract, event.clientX, event.clientY)
  }
  const openKeyboardContext = (event, kind, contract = null) => {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
    event.preventDefault()
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    showMenu(kind === 'node' ? 'contract' : 'standalone', contract, rect.left + rect.width / 2, rect.top + rect.height / 2)
  }
  useEffect(() => {
    const close = event => {
      if (event.key !== 'Escape') return
      if (interaction.current) {
        const pointer = interaction.current
        interaction.current = null
        try { viewport.current?.releasePointerCapture(pointer.pointerId) } catch { /* pointer may already be released */ }
      }
      setContextMenu(null)
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [])
  const reset = () => {
    setOverrides({})
    try { localStorage.removeItem(STORAGE_KEY) } catch { /* optional */ }
    // Reset to the auto-layout at actual 100%, not the prior saved zoom.
    const pts = Object.values(auto.positions)
    if (!pts.length) { setView({ x: 0, y: 0, scale: 1 }); return }
    const rect = viewport.current?.getBoundingClientRect()
    if (!rect) return
    const left = Math.min(...pts.map(p => p.x)), top = Math.min(...pts.map(p => p.y))
    const right = Math.max(...pts.map(p => p.x + NODE_WIDTH)), bottom = Math.max(...pts.map(p => p.y + NODE_HEIGHT))
    setView({x:(rect.width-left-right)/2,y:(rect.height-top-bottom)/2,scale:1})
  }
  useEffect(() => {
    const element = viewport.current
    if (!element) return
    const wheel = event => {
      event.preventDefault()
      const box = element.getBoundingClientRect()
      setView(v => {
        const scale = clamp(v.scale * (event.deltaY < 0 ? 1.08 : 1 / 1.08), MIN_SCALE, MAX_SCALE)
        const ratio = scale / v.scale
        const x = event.clientX - box.left, y = event.clientY - box.top
        return { scale, x: x - (x - v.x) * ratio, y: y - (y - v.y) * ratio }
      })
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [])
  return <div className="lineage-wrapper">
    <div className="canvas-toolbar" role="toolbar" aria-label="Canvas controls">
      <span className="canvas-hint"><Move size={15}/> Drag to move or pan · Right-click / double-click for options · Esc to close</span>
      <button title="Zoom out (decrease canvas scale)" aria-label="Zoom out" onClick={() => zoomAt(1 / 1.2, (viewport.current?.clientWidth || 800) / 2, (viewport.current?.clientHeight || 550) / 2)}><Minus size={17}/></button>
      <span className="zoom-level" title="Current canvas zoom level">{Math.round(view.scale * 100)}%</span>
      <button title="Zoom in (increase canvas scale)" aria-label="Zoom in" onClick={() => zoomAt(1.2, (viewport.current?.clientWidth || 800) / 2, (viewport.current?.clientHeight || 550) / 2)}><Plus size={17}/></button>
      <button title="Fit all contracts into view" aria-label="Fit all contracts" onClick={fit}><Maximize2 size={16}/></button>
      <button title="Reset card positions and zoom to 100%" aria-label="Reset positions" onClick={reset}><RotateCcw size={16}/></button>
    </div>
    <div className="canvas-viewport" ref={viewport} onPointerDown={e => start(e, 'pan')} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onContextMenu={e => openContext(e, 'pan')} aria-label="Interactive contract lineage canvas" tabIndex={0} onKeyDown={e => openKeyboardContext(e, 'pan')}>
      <div className="canvas-world" style={{ width: bounds.width, height: bounds.height, transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
        <svg className="canvas-connections" width={bounds.width} height={bounds.height} aria-hidden="true"><defs><marker id="lineage-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" fill="#009c58"/></marker></defs>{edges.map(e => <path key={e.id} d={e.path} fill="none" stroke="#009c58" strokeWidth="2.2" markerEnd="url(#lineage-arrow)"/>)}</svg>
        {contracts.map(c => <button key={c.id} type="button" className={`contract-card canvas-card ${c.uses ? 'child' : ''}`} style={{left: positions[c.id]?.x || 0, top: positions[c.id]?.y || 0}} onPointerDown={e => start(e, 'node', c.id)} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onContextMenu={e => openContext(e, 'node', c)} onDoubleClick={e => openDoubleClick(e, c)} onKeyDown={e => openKeyboardContext(e, 'node', c)} aria-label={`Options for ${c.name} contract (double-click, right-click or Shift+F10)`}><span className="card-emoji" aria-hidden="true">{c.uses ? '🔗' : '📦'}</span><strong>{c.name}</strong><span className="card-badge">{c.uses ? 'CHILD CONTRACT' : 'STANDALONE CONTRACT'}</span><small>{c.uses ? `uses ${c.uses.name} v${c.uses.version}` : `v${c.version} · ${c.attributes.length} attributes, ${c.metrics.length} metrics`}</small></button>)}
      </div>
      {!contracts.length && <p className="canvas-empty">Right-click anywhere to create your first standalone contract</p>}
      {contextMenu && <div className="canvas-context-menu" role="group" aria-label={contextMenu.kind === 'standalone' ? 'Canvas creation options' : 'Contract actions'} style={{ left: contextMenu.x, top: contextMenu.y }} onPointerDown={e => e.stopPropagation()} onPointerUp={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
        {contextMenu.kind === 'standalone' ? <button type="button" autoFocus onClick={() => {setContextMenu(null);onCreateStandalone()}}><Plus size={16}/> Create Standalone Contract</button> : <>
          <div className="canvas-context-title">{contracts.find(c => c.id === contextMenu.id)?.name}</div>
          <button type="button" autoFocus onClick={() => {const id=contextMenu.id;setContextMenu(null);onOpen(id)}}><Eye size={16}/> View Contract</button>
          <button type="button" onClick={() => {const c=contracts.find(c => c.id === contextMenu.id);setContextMenu(null);if(c)onCreateChild(c)}}><GitBranch size={16}/> Create Child Contract</button>
        </>}
      </div>}
    </div>
  </div>
}
