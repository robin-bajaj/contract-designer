/** Build a nested explorer from versioned contract inheritance (uses.name + uses.version).
 * Matching descendants keep their ancestors visible so search retains context.
 * Missing parents and cyclic drafts appear at the root instead of disappearing.
 */
export function buildContractTree(contracts, query = '') {
  const byKey = new Map(contracts.map(contract => [contractKey(contract), contract]))
  const parentOf = new Map()
  for (const contract of contracts) {
    const parent = contract.uses && byKey.get(`${contract.uses.name}@${Number(contract.uses.version)}`)
    if (parent && parent.id !== contract.id) parentOf.set(contract.id, parent.id)
  }
  const byId = new Map(contracts.map(contract => [contract.id, contract]))
  // Break cycles locally for display; authoritative validation still rejects them.
  for (const contract of contracts) {
    const visited = new Set([contract.id])
    let cursor = contract.id
    while (parentOf.has(cursor)) {
      cursor = parentOf.get(cursor)
      if (visited.has(cursor)) {
        parentOf.delete(contract.id)
        break
      }
      visited.add(cursor)
    }
  }

  const normalized = query.trim().toLowerCase()
  const visible = new Set()
  for (const contract of contracts) {
    if (!normalized || contract.name.toLowerCase().includes(normalized)) {
      let cursor = contract.id
      const visited = new Set()
      while (cursor && !visited.has(cursor)) {
        visited.add(cursor)
        visible.add(cursor)
        cursor = parentOf.get(cursor)
      }
    }
  }
  const children = new Map(contracts.map(contract => [contract.id, []]))
  const roots = []
  for (const contract of contracts) {
    if (!visible.has(contract.id)) continue
    const parentId = parentOf.get(contract.id)
    if (parentId && visible.has(parentId)) children.get(parentId).push(contract)
    else roots.push(contract)
  }
  const toNode = contract => ({
    contract,
    children: (children.get(contract.id) || []).map(toNode),
  })
  return { roots: roots.map(toNode), visibleCount: visible.size, matchingCount: contracts.filter(c => c.name.toLowerCase().includes(normalized)).length }
}

export function contractKey(contract) {
  return `${contract.name}@${Number(contract.version)}`
}

/** Exact logical contract name, not the legacy underscored/versioned registry filename. */
export function contractFilename(contract) {
  return `${contract.name}.yml`
}
