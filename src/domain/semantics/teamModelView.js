/** Resolve inherited definitions from the approved CDO registry, version by version. */
export function resolveContract(name, version, registry, visited = new Set()) {
  const identity = `${name}@${Number(version)}`
  if (visited.has(identity)) return { error: `Circular contract inheritance at ${identity}` }
  const contract = registry.find(c => c.name === name && Number(c.version) === Number(version))
  if (!contract) return { error: `CDO contract ${identity} is missing from approved GitHub main` }
  if (!contract.uses) return { contract, attributes: contract.attributes || [], metrics: contract.metrics || [] }
  const parent = resolveContract(contract.uses.name, contract.uses.version, registry, new Set([...visited, identity]))
  if (parent.error) return { error: parent.error, contract }
  const includedAttributes = new Set((contract.include?.attributes || []).map(item => typeof item === 'string' ? item : item.name))
  const includedMetrics = new Set((contract.include?.metrics || []).map(item => typeof item === 'string' ? item : item.name))
  return {
    contract,
    attributes: parent.attributes.filter(item => includedAttributes.has(item.name)),
    metrics: parent.metrics.filter(item => includedMetrics.has(item.name)),
  }
}

export function describeTeamSemanticModel(model, registry) {
  const meta = model.config?.meta || {}
  const ref = meta.uses || null
  const resolved = ref ? resolveContract(ref.name, ref.version, registry) : null
  const requestedAttributes = (meta.include?.attributes || []).map(item => typeof item === 'string' ? { name: item } : item)
  const requestedMetrics = (meta.include?.metrics || []).map(item => typeof item === 'string' ? { name: item } : item)
  const attributesByName = new Map((resolved?.attributes || []).map(item => [item.name, item]))
  const metricsByName = new Map((resolved?.metrics || []).map(item => [item.name, item]))
  const inheritedAttributes = requestedAttributes.map(selected => ({
    ...selected,
    canonical: attributesByName.get(selected.name) || null,
    missing: !attributesByName.has(selected.name),
  }))
  const inheritedMetrics = requestedMetrics.map(selected => ({
    ...selected,
    canonical: metricsByName.get(selected.name) || null,
    missing: !metricsByName.has(selected.name),
  }))
  return {
    id: model.id,
    modelName: model.name,
    semanticName: model.semantic_model?.name || model.name,
    description: model.description || '',
    sourcePath: model.sourcePath,
    contractRef: ref,
    contractError: resolved?.error || null,
    inheritedAttributes,
    inheritedMetrics,
    teamColumns: model.columns || [],
    teamMetrics: model.metrics || [],
    dbtContractEnforced: model.config?.contract?.enforced === true,
    group: model.config?.group || null,
    access: model.config?.access || null,
    aggTimeDimension: model.agg_time_dimension || null,
  }
}
