import yaml from 'js-yaml'
import { initialContracts, toContractDocument } from './contracts.js'
import { contractKey } from './contractTree.js'
import { GOVERNANCE_REPO } from './githubPublish.js'

export const REGISTRY_BASELINE_KEY = 'contract-designer.github-registry.v1'
const copy = value => JSON.parse(JSON.stringify(value))
const equivalent = (a, b) => JSON.stringify(toContractDocument(a)) === JSON.stringify(toContractDocument(b))

export function parseRegistryContract(source) {
  const doc = yaml.load(source)
  if (!doc || typeof doc !== 'object' || Array.isArray(doc) ||
      !/^[a-z][a-z0-9_.]*$/.test(doc.name) || !Number.isSafeInteger(doc.version) || doc.version < 1 ||
      (doc.uses && (!doc.uses.name || !Number.isSafeInteger(doc.uses.version))) ||
      (!doc.uses && (!Array.isArray(doc.attributes) || !Array.isArray(doc.metrics)))) {
    throw Error('Invalid logical contract YAML in governance registry')
  }
  return {
    id: `github:${doc.name}@${doc.version}`,
    name: doc.name, version: doc.version, description: doc.description || '',
    uses: doc.uses ? { name: doc.uses.name, version: doc.uses.version } : null,
    include: doc.uses ? { attributes: copy(doc.include?.attributes || []), metrics: copy(doc.include?.metrics || []) } : null,
    attributes: doc.uses ? [] : copy(doc.attributes),
    metrics: doc.uses ? [] : copy(doc.metrics),
  }
}

/** Only completed, merged files on main are imported. Pending PRs are excluded. */
export async function fetchGovernanceContracts(fetchImpl = fetch, token = '') {
  const headers = { Accept: 'application/vnd.github+json' }
  if (token?.trim()) headers.Authorization = `Bearer ${token.trim()}`
  const prefix = `https://api.github.com/repos/${GOVERNANCE_REPO}`
  const listResponse = await fetchImpl(`${prefix}/contents/contracts?ref=main`, { headers })
  if (!listResponse.ok) throw Error(`GitHub registry listing failed (HTTP ${listResponse.status})`)
  const files = await listResponse.json()
  if (!Array.isArray(files)) throw Error('Unexpected GitHub registry response')
  const entries = files.filter(f => f.type === 'file' && /\.ya?ml$/i.test(f.name))
  if (!entries.length) throw Error('No YAML contracts found in governance repository')
  const contracts = await Promise.all(entries.map(async file => {
    // Use the GitHub contents API rather than trusting an arbitrary download URL.
    const response = await fetchImpl(`${prefix}/contents/${encodeURIComponent(file.name)}?ref=main`, {
      headers: { ...headers, Accept: 'application/vnd.github.raw+json' },
    })
    if (!response.ok) throw Error(`Unable to read ${file.name} (HTTP ${response.status})`)
    let body = await response.text()
    // Some API gateways return JSON instead of honoring the raw Accept header.
    if (body.trim().startsWith('{')) {
      try {
        const maybe = JSON.parse(body)
        if (maybe.encoding === 'base64' && typeof maybe.content === 'string') {
          const binary = atob(maybe.content.replace(/\s/g, ''))
          body = new TextDecoder().decode(Uint8Array.from(binary, c => c.charCodeAt(0)))
        }
      } catch { /* raw YAML may be JSON-looking; parser below validates */ }
    }
    const contract = parseRegistryContract(body)
    return contract
  }))
  if (new Set(contracts.map(contractKey)).size !== contracts.length) throw Error('Duplicate contract name/version in GitHub registry')
  return contracts
}
export function restoreRegistryBaseline(storage = globalThis.localStorage) {
  try {
    const saved = JSON.parse(storage?.getItem(REGISTRY_BASELINE_KEY) || '[]')
    return Array.isArray(saved) ? saved : []
  } catch { return [] }
}
export function persistRegistryBaseline(contracts, storage = globalThis.localStorage) {
  try { storage?.setItem(REGISTRY_BASELINE_KEY, JSON.stringify(contracts)); return true } catch { return false }
}

/** Three-way merge: never replace a locally changed draft. Existing id and canvas positions survive. */
export function mergeRegistryContracts(local, remote, previous = []) {
  const seeds = new Map(initialContracts.map(c => [contractKey(c), c]))
  const baselines = new Map(previous.map(c => [contractKey(c), c]))
  const result = copy(local)
  let added = 0, updated = 0, preserved = 0
  for (const source of remote) {
    const key = contractKey(source)
    const index = result.findIndex(c => contractKey(c) === key)
    if (index < 0) {
      result.push({ ...copy(source), id: result.some(c => c.id === source.id) ? `github:${key}` : source.id })
      added++
      continue
    }
    const existing = result[index]
    const baseline = baselines.get(key) || seeds.get(key)
    if (baseline && equivalent(existing, baseline)) {
      result[index] = { ...copy(source), id: existing.id }
      updated++
    } else if (equivalent(existing, source)) {
      // Already up to date; do not disturb canvas state.
    } else preserved++
  }
  return { contracts: result, added, updated, preserved }
}
