import { initialContracts } from './contracts.js'

export const DRAFT_STORAGE_KEY = 'contract-designer.contracts.v1'
const clone = value => JSON.parse(JSON.stringify(value))
export function restoreContracts(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(DRAFT_STORAGE_KEY)
    if (!raw) return clone(initialContracts)
    const saved = JSON.parse(raw)
    if (!Array.isArray(saved) || saved.some(c => !c || typeof c.id !== 'string' || typeof c.name !== 'string' || !Array.isArray(c.attributes) || !Array.isArray(c.metrics))) {
      throw Error('Invalid saved drafts')
    }
    return saved
  } catch {
    return clone(initialContracts)
  }
}
export function persistContracts(contracts, storage = globalThis.localStorage) {
  try {
    storage?.setItem(DRAFT_STORAGE_KEY, JSON.stringify(contracts))
    return true
  } catch {
    return false
  }
}
