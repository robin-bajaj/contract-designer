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

export function lineageEdges(contracts, positions) {
  const byKey = new Map(contracts.map(c => [contractKey(c), c]))
  return contracts.flatMap(c => {
    if (!c.uses) return []
    const parent = findParent(byKey, c)
    if (!parent || !positions[parent.id] || !positions[c.id]) return []
    const a = positions[parent.id], b = positions[c.id]
    return [{ id: `${parent.id}->${c.id}`, from: parent.id, to: c.id,
      path: `M ${a.x + NODE_WIDTH / 2} ${a.y + NODE_HEIGHT} V ${a.y + NODE_HEIGHT + 32} H ${b.x + NODE_WIDTH / 2} V ${b.y - 7}` }]
  })
}
