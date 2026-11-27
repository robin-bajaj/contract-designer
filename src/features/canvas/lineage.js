/** Deterministic, dependency-free layered positions for contract inheritance. */
export const NODE_WIDTH = 202
export const NODE_HEIGHT = 150
export const X_GAP = 54
export const Y_GAP = 110

/** Match the exact version pinned in uses, not the latest contract with the same name. */
const contractKey = c => `${c.name}@${Number(c.version)}`
const findParent = (byKey, child) => child.uses
  ? byKey.get(`${child.uses.name}@${Number(child.uses.version)}`)
  : undefined

export function createLineageLayout(contracts) {
  const byKey = new Map(contracts.map(c => [contractKey(c), c]))
  const depthMemo = new Map()
  const depthFor = (contract, visited = new Set()) => {
    if (depthMemo.has(contract.id)) return depthMemo.get(contract.id)
    if (visited.has(contract.id)) return 0 // tolerate draft cycles; validator rejects them
    const parent = findParent(byKey, contract)
    const depth = parent && parent.id !== contract.id
      ? 1 + depthFor(parent, new Set([...visited, contract.id]))
      : 0
    depthMemo.set(contract.id, depth)
    return depth
  }
  const layers = new Map()
  for (const c of contracts) {
    const depth = depthFor(c)
    if (!layers.has(depth)) layers.set(depth, [])
    layers.get(depth).push(c)
  }
  const maxCount = Math.max(1, ...[...layers.values()].map(group => group.length))
  const width = Math.max(680, maxCount * (NODE_WIDTH + X_GAP) + 120)
  const positions = {}
  for (const [level, group] of [...layers.entries()].sort((a, b) => a[0] - b[0])) {
    const groupWidth = group.length * NODE_WIDTH + (group.length - 1) * X_GAP
    const startX = (width - groupWidth) / 2
    for (const [i, c] of group.entries()) positions[c.id] = {
      x: startX + i * (NODE_WIDTH + X_GAP),
      y: 66 + level * (NODE_HEIGHT + Y_GAP),
    }
  }
  const maxLevel = Math.max(0, ...layers.keys())
  return { positions, width, height: Math.max(430, 66 + (maxLevel + 1) * (NODE_HEIGHT + Y_GAP)) }
}

// Shape-bound connector geometry, similar to Excalidraw arrows.
// An endpoint is found where the center-to-center ray hits the edge of each
// rectangle. Unlike fixed bottom/top ports, it follows the nearest facing
// sides as the cards move around each other.
const SOURCE_GAP = 3
const TARGET_GAP = 9

function attachToRectangle(rect, towardX, towardY) {
  const x = rect.left + rect.width / 2
  const y = rect.top + rect.height / 2
  const hw = rect.width / 2
  const hh = rect.height / 2
  const dx = towardX - x
  const dy = towardY - y

  // Overlapping centers are degenerate. Choose bottom until the user moves
  // either card, at which point their actual relative direction is used.
  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
    return { x, y: y + hh, nx: 0, ny: 1, side: 'bottom' }
  }

  const tx = Math.abs(dx) < 0.001 ? Infinity : hw / Math.abs(dx)
  const ty = Math.abs(dy) < 0.001 ? Infinity : hh / Math.abs(dy)
  const t = Math.min(tx, ty)

  if (tx < ty) {
    const nx = Math.sign(dx)
    return { x: x + dx * t, y: y + dy * t, nx, ny: 0, side: nx > 0 ? 'right' : 'left' }
  }
  const ny = Math.sign(dy)
  return { x: x + dx * t, y: y + dy * t, nx: 0, ny, side: ny > 0 ? 'bottom' : 'top' }
}

/**
 * Return a straight, shape-bound arrow between two actual rendered rectangles.
 * Coordinates are pixel coordinates; gap keeps the marker away from borders.
 * Arrows are independent of node drag, zoom, pan, and relative orientation.
 */
export function boundArrowBetween(parentRect, childRect) {
  const a = { left: parentRect.left, top: parentRect.top,
    width: parentRect.width, height: parentRect.height }
  const b = { left: childRect.left, top: childRect.top,
    width: childRect.width, height: childRect.height }
  if (![a.left,a.top,a.width,a.height,b.left,b.top,b.width,b.height].every(Number.isFinite)
      || a.width <= 0 || a.height <= 0 || b.width <= 0 || b.height <= 0) return null

  const ax = a.left + a.width / 2, ay = a.top + a.height / 2
  const bx = b.left + b.width / 2, by = b.top + b.height / 2
  const from = attachToRectangle(a, bx, by)
  const to = attachToRectangle(b, ax, ay)
  const start = { x: from.x + from.nx * SOURCE_GAP, y: from.y + from.ny * SOURCE_GAP }
  const end = { x: to.x + to.nx * TARGET_GAP, y: to.y + to.ny * TARGET_GAP }

  // When the cards physically overlap, keep the arrow from turning around.
  // A zero-length/negative-length connector is hidden until separated.
  const forward = (end.x - start.x) * (bx - ax) + (end.y - start.y) * (by - ay)
  if (forward <= 1) return null

  return { start, end, fromSide: from.side, toSide: to.side,
    path: `M ${start.x} ${start.y} L ${end.x} ${end.y}` }
}

export function lineageEdges(contracts, positions) {
  const byKey = new Map(contracts.map(c => [contractKey(c), c]))
  return contracts.flatMap(child => {
    if (!child.uses) return []
    const parent = findParent(byKey, child)
    if (!parent || !positions[parent.id] || !positions[child.id]) return []
    const a = positions[parent.id], b = positions[child.id]
    const arrow = boundArrowBetween(
      {left:a.x,top:a.y,width:NODE_WIDTH,height:NODE_HEIGHT},
      {left:b.x,top:b.y,width:NODE_WIDTH,height:NODE_HEIGHT},
    )
    return arrow ? [{id:`${parent.id}->${child.id}`,from:parent.id,to:child.id,...arrow}] : []
  })
}

/**
 * Screen-space bounds from rendered cards, not guessed world coordinates.
 * Every edge is pinned to the exact parent name+version in uses.
 */
export function lineageEdgesFromRects(contracts, cardRects, viewportRect) {
  const byKey = new Map(contracts.map(c => [contractKey(c), c]))
  return contracts.flatMap(child => {
    if (!child.uses) return []
    const parent = findParent(byKey, child)
    const a = parent && cardRects[parent.id]
    const b = cardRects[child.id]
    if (!a || !b) return []

    const arrow = boundArrowBetween(
      {left:a.left - viewportRect.left,top:a.top - viewportRect.top,width:a.width,height:a.height},
      {left:b.left - viewportRect.left,top:b.top - viewportRect.top,width:b.width,height:b.height},
    )
    return arrow ? [{id:`${parent.id}->${child.id}`,from:parent.id,to:child.id,...arrow}] : []
  })
}
