/** Cache of the last approved GitHub main snapshot, not editable contract drafts. */
export const REGISTRY_BASELINE_KEY = 'contract-designer.github-registry.v1'

export function restoreRegistryBaseline(storage = globalThis.localStorage) {
  try {
    const saved = JSON.parse(storage?.getItem(REGISTRY_BASELINE_KEY) || '[]')
    return Array.isArray(saved) ? saved : []
  } catch { return [] }
}
export function persistRegistryBaseline(contracts, storage = globalThis.localStorage) {
  try { storage?.setItem(REGISTRY_BASELINE_KEY, JSON.stringify(contracts)); return true } catch { return false }
}

