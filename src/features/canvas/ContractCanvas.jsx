import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Focus, Minus, Plus, Move, Eye, GitBranch } from 'lucide-react'
import { canvasContextAction, positionCanvasMenu } from './canvasActions.js'
import { createLineageLayout, lineageEdgesFromRects, NODE_WIDTH, NODE_HEIGHT } from './lineage.js'

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
  const cardRefs = useRef(new Map())
  const [edgePaths, setEdgePaths] = useState([])
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
  const bounds = useMemo(() => ({
    width: Math.max(auto.width, ...Object.values(positions).map(p => p.x + NODE_WIDTH + 70)),
    height: Math.max(auto.height, ...Object.values(positions).map(p => p.y + NODE_HEIGHT + 70)),
  }), [auto, positions])

  // Cards and connectors must share the *rendered* coordinate space. Measuring
  // DOM rectangles prevents detachment when zoom/pan or cached card positions
  // differ from the SVG's intrinsic coordinate system.
  const measureEdges = useCallback(() => {
    const root = viewport.current
    if (!root) return
    const rect = root.getBoundingClientRect()
    const cardRects = Object.fromEntries(
      contracts.map(c => [c.id, cardRefs.current.get(c.id)?.getBoundingClientRect()])
        .filter(([, box]) => Boolean(box))
    )
    const next = lineageEdgesFromRects(contracts, cardRects, rect)
    setEdgePaths(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next)
  }, [contracts])
  useLayoutEffect(() => { measureEdges() }, [measureEdges, positions, view])
  useEffect(() => {
    const root = viewport.current
    if (!root || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measureEdges)
    observer.observe(root)
    for (const card of cardRefs.current.values()) observer.observe(card)
    return () => observer.disconnect()
  }, [measureEdges])

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
  // Default to true 100% zoom, centered on the graph, rather than auto-fit.
  // The single center control returns to this scale without changing any card position.
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
      <button type="button" data-tooltip="Zoom out · reduce scale" aria-label="Zoom out" onClick={() => zoomAt(1 / 1.2, (viewport.current?.clientWidth || 800) / 2, (viewport.current?.clientHeight || 550) / 2)}><Minus size={17}/></button>
      <span className="zoom-level" data-tooltip="Current zoom level" tabIndex={0} aria-label={`Canvas zoom ${Math.round(view.scale * 100)} percent`}>{Math.round(view.scale * 100)}%</span>
      <button type="button" data-tooltip="Zoom in · increase scale" aria-label="Zoom in" onClick={() => zoomAt(1.2, (viewport.current?.clientWidth || 800) / 2, (viewport.current?.clientHeight || 550) / 2)}><Plus size={17}/></button>
      <button type="button" data-tooltip="Center canvas at 100% · preserves card positions" aria-label="Center canvas at 100%" onClick={() => centerAt(1)}><Focus size={16}/></button>
    </div>
    <div className="canvas-viewport" ref={viewport} onPointerDown={e => start(e, 'pan')} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onContextMenu={e => openContext(e, 'pan')} aria-label="Interactive contract lineage canvas" tabIndex={0} onKeyDown={e => openKeyboardContext(e, 'pan')}>
      <div className="canvas-world" style={{ width: bounds.width, height: bounds.height, transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>

        {contracts.map(c => <button key={c.id} ref={element => { if(element) cardRefs.current.set(c.id,element); else cardRefs.current.delete(c.id) }} type="button" className={`contract-card canvas-card ${c.uses ? 'child' : ''}`} style={{left: positions[c.id]?.x || 0, top: positions[c.id]?.y || 0}} onPointerDown={e => start(e, 'node', c.id)} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onContextMenu={e => openContext(e, 'node', c)} onDoubleClick={e => openDoubleClick(e, c)} onKeyDown={e => openKeyboardContext(e, 'node', c)} aria-label={`Options for ${c.name} contract (double-click, right-click or Shift+F10)`}><span className="card-emoji" aria-hidden="true">{c.uses ? '🔗' : '📦'}</span><strong>{c.name}</strong><span className="card-badge">{c.uses ? 'CHILD CONTRACT' : 'STANDALONE CONTRACT'}</span><small>{c.uses ? `uses ${c.uses.name} v${c.uses.version}` : `v${c.version} · ${c.attributes.length} attributes, ${c.metrics.length} metrics`}</small></button>)}
      </div>
      <svg className="canvas-connections-overlay" aria-hidden="true"><defs><marker id="lineage-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" fill="#009c58"/></marker></defs>{edgePaths.map(e => <path key={e.id} d={e.path} fill="none" stroke="#009c58" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" markerEnd="url(#lineage-arrow)"/>)}</svg>
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
