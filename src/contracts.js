export const initialContracts = [
  {
    id: 'cdo.all', name: 'cdo.all', version: 1, description: 'Enterprise business dictionary. Logical definitions only; not a dbt model.', uses: null,
    attributes: [
      { name: 'position_id', data_type: 'text', description: 'Position identifier' },
      { name: 'report_date', data_type: 'date', description: 'Business reporting date' },
      { name: 'profit_loss', data_type: 'numeric', description: 'Standardized profit and loss' },
      { name: 'instrument_code', data_type: 'integer', description: 'Financial instrument identifier' },
      { name: 'counterparty_id', data_type: 'text', description: 'Unique identifier of a counterparty' },
      { name: 'counterparty_name', data_type: 'text', description: 'Legal or business name of a counterparty' },
      { name: 'counterparty_type', data_type: 'text', description: 'Business classification of the counterparty' },
    ],
    metrics: [{ name: 'total_profit_loss', description: 'Total position profit and loss', type: 'simple', agg: 'sum', expr: 'profit_loss', fill_nulls_with: 0 }],
    include: null,
  },
  { id: 'cdo.position', name: 'cdo.position', version: 1, description: 'Logical Position business concept.', uses: { name: 'cdo.all', version: 1 }, attributes: [], metrics: [], include: { attributes: ['position_id', 'report_date', 'profit_loss', 'instrument_code'], metrics: ['total_profit_loss'] } },
  { id: 'cdo.counterparty', name: 'cdo.counterparty', version: 1, description: 'Logical Counterparty business concept.', uses: { name: 'cdo.all', version: 1 }, attributes: [], metrics: [], include: { attributes: ['counterparty_id', 'counterparty_name', 'counterparty_type'], metrics: [] } },
]
export function toContractDocument(contract) {
  const out = { name: contract.name, version: Number(contract.version) || 1 }
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
    const parent = contracts.find(c => c.name === contract.uses.name && Number(c.version) === Number(contract.uses.version))
    if (!parent) errors.push(`Parent contract ${contract.uses.name} v${contract.uses.version} was not found.`)
    else {
      // Resolve effective inherited names, including parent-of-parent contracts.
      const resolve = (c, seen = new Set()) => {
        if (seen.has(c.name)) return { attributes: [], metrics: [], cycle: true }
        if (!c.uses) return { attributes: c.attributes.map(a => a.name), metrics: c.metrics.map(m => m.name) }
        const p = contracts.find(x => x.name === c.uses.name && Number(x.version) === Number(c.uses.version))
        if (!p) return { attributes: [], metrics: [] }
        const inherited = resolve(p, new Set([...seen, c.name]))
        return { attributes: (c.include?.attributes || []).filter(n => inherited.attributes.includes(n)), metrics: (c.include?.metrics || []).filter(n => inherited.metrics.includes(n)), cycle: inherited.cycle }
      }
      const available = resolve(parent, new Set([contract.name]))
      if (available.cycle || parent.name === contract.name) errors.push('Circular contract inheritance is not allowed.')
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
      if (!names.includes(m.expr)) errors.push(`Metric ${m.name} references missing attribute ${m.expr}.`)
      if (m.agg === 'sum' && !['numeric', 'integer', 'bigint'].includes(contract.attributes.find(a => a.name === m.expr)?.data_type)) errors.push(`SUM metric ${m.name} requires a numeric attribute.`)
    }
  }
  return errors
}
