import { metricAggregationError } from './dbtOptions.js'

export function toContractDocument(contract) {
  const out = { name: contract.name, version: Number(contract.version) || 1 }
  // The current CDO registry accepts top-level description on standalone contracts.
  // Child contracts use a strict name/version/uses/include schema for now.
  if (!contract.uses && typeof contract.description === 'string' && contract.description.trim()) {
    out.description = contract.description.trim()
  }
  if (contract.uses) {
    out.uses = { name: contract.uses.name, version: Number(contract.uses.version) || 1 }
    out.include = { attributes: contract.include?.attributes || [], metrics: contract.include?.metrics || [] }
  } else {
    out.attributes = contract.attributes.map(x => { const o = { name: x.name, data_type: x.data_type }; if (x.description) o.description = x.description; return o })
    out.metrics = contract.metrics.map(x => { const o = { name: x.name, type: x.type || 'simple', agg: x.agg || 'sum', expr: x.expr || '' }; if (x.description) o.description = x.description; if (x.fill_nulls_with !== '' && x.fill_nulls_with !== undefined && x.fill_nulls_with !== null) o.fill_nulls_with = Number(x.fill_nulls_with); return o })
  }
  return out
}
export function validateContract(contract, contracts) {
  const errors = []
  if (!/^[a-z][a-z0-9_.]*$/.test(contract.name)) errors.push('Contract name must use lowercase letters, digits, underscores or periods.')
  if (!Number.isInteger(Number(contract.version)) || Number(contract.version) < 1) errors.push('Version must be a positive integer.')
  if (contracts.filter(c => c.id !== contract.id && c.name === contract.name && Number(c.version) === Number(contract.version)).length) errors.push('A contract with this name/version already exists.')
  if (contract.uses) {
    const contractIdentity = c => `${c.name}@${Number(c.version)}`
    const parent = contracts.find(c => c.name === contract.uses.name && Number(c.version) === Number(contract.uses.version))
    if (!parent) errors.push(`Parent contract ${contract.uses.name} v${contract.uses.version} was not found.`)
    else {
      // Resolve effective inherited names, including parent-of-parent contracts.
      const resolve = (c, seen = new Set()) => {
        if (seen.has(contractIdentity(c))) return { attributes: [], metrics: [], cycle: true }
        if (!c.uses) return { attributes: c.attributes.map(a => a.name), metrics: c.metrics.map(m => m.name) }
        const p = contracts.find(x => x.name === c.uses.name && Number(x.version) === Number(c.uses.version))
        if (!p) return { attributes: [], metrics: [] }
        const inherited = resolve(p, new Set([...seen, contractIdentity(c)]))
        return { attributes: (c.include?.attributes || []).filter(n => inherited.attributes.includes(n)), metrics: (c.include?.metrics || []).filter(n => inherited.metrics.includes(n)), cycle: inherited.cycle }
      }
      const available = resolve(parent, new Set([contractIdentity(contract)]))
      if (available.cycle || contractIdentity(parent) === contractIdentity(contract)) errors.push('Circular contract inheritance is not allowed.')
      for (const name of contract.include?.attributes || []) if (!available.attributes.includes(name)) errors.push(`Unknown inherited attribute: ${name}`)
      for (const name of contract.include?.metrics || []) if (!available.metrics.includes(name)) errors.push(`Unknown inherited metric: ${name}`)
    }
  } else {
    const names = contract.attributes.map(a => a.name)
    if (new Set(names).size !== names.length) errors.push('Duplicate attribute names are not allowed.')
    for (const a of contract.attributes) if (!/^[a-zA-Z_][\w]*$/.test(a.name)) errors.push(`Invalid attribute name: ${a.name}`)
    if (new Set(contract.metrics.map(m => m.name)).size !== contract.metrics.length) errors.push('Duplicate metric names are not allowed.')
    for (const m of contract.metrics) {
      if (!/^[a-zA-Z_][\w]*$/.test(m.name)) errors.push(`Invalid metric name: ${m.name}`)
      const metricError = metricAggregationError(m, contract.attributes)
      if (metricError) errors.push(metricError)
    }
  }
  return errors
}
