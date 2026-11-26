import yaml from 'js-yaml'
import { contractKey } from '../../domain/contracts/contractTree.js'
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

/** Read only files committed to governance main. A CDN fallback handles GitHub REST throttling. */
export async function fetchGovernanceContracts(fetchImpl = fetch, token = '') {
  const headers = { Accept: 'application/vnd.github+json' }
  if (token?.trim()) headers.Authorization = `Bearer ${token.trim()}`
  const prefix = `https://api.github.com/repos/${GOVERNANCE_REPO}`
  let entries = []
  const listing = await fetchImpl(`${prefix}/contents/contracts?ref=main`, { headers })
  if (listing.ok) {
    const files = await listing.json()
    if (!Array.isArray(files)) throw Error('Invalid GitHub registry listing')
    entries = files.filter(f => f.type === 'file' && /\.ya?ml$/i.test(f.name)).map(f => f.name)
  } else if (listing.status === 403 || listing.status === 429) {
    // Public CDN metadata is separate from api.github.com rate limits.
    const fallback = await fetchImpl(`https://data.jsdelivr.com/v1/package/gh/${GOVERNANCE_REPO}@main/flat`)
    if (!fallback.ok) throw Error(`Registry listing limited (GitHub HTTP ${listing.status}, CDN HTTP ${fallback.status}). Try again later.`)
    const result = await fallback.json()
    entries = (result.files || []).map(f => f.name).filter(name => /^\/contracts\/[^/]+\.ya?ml$/i.test(name)).map(name => name.split('/').pop())
  } else throw Error(`GitHub registry listing failed (HTTP ${listing.status})`)
  if (!entries.length) throw Error('No YAML contracts found in the governance registry')
  const contracts = await Promise.all(entries.map(async name => {
    // Public raw content avoids one GitHub REST request per contract.
    const rawUrl = `https://raw.githubusercontent.com/${GOVERNANCE_REPO}/main/contracts/${encodeURIComponent(name)}`
    let response = await fetchImpl(rawUrl)
    if (!response.ok) {
      response = await fetchImpl(`https://cdn.jsdelivr.net/gh/${GOVERNANCE_REPO}@main/contracts/${encodeURIComponent(name)}`)
    }
    if (!response.ok) throw Error(`Unable to read ${name} (HTTP ${response.status})`)
    return parseRegistryContract(await response.text())
  }))
  if (new Set(contracts.map(contractKey)).size !== contracts.length) throw Error('Duplicate contract name/version in GitHub registry')
  return contracts
}
