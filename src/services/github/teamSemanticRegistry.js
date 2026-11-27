import yaml from 'js-yaml'
export const FEDERATED_REPO = 'robin-bajaj/federated-semantic-poc'

export function teamFolder(role) {
  if (typeof role !== 'string' || !/^team-[a-z][a-z0-9-]{0,48}$/.test(role)) {
    throw Error('Invalid team role')
  }
  return role.replaceAll('-', '_')
}

export function parseTeamSemanticFile(source, path, role) {
  const definition = yaml.load(source)
  if (!definition || !Array.isArray(definition.models)) {
    throw Error(`Invalid dbt model properties in ${path}`)
  }
  return definition.models.filter(model => model && typeof model.name === 'string' &&
    (model.semantic_model?.enabled === true || model.config?.meta?.uses)).map((model, index) => ({
    ...model,
    id: `${path}#${model.name}-${index}`,
    sourcePath: path,
    teamRole: role,
  }))
}

/** Enumerate authored team YAML on main; never use generated/production models. */
export async function fetchTeamSemanticModels(role, fetchImpl = fetch) {
  const folder = teamFolder(role)
  const path = `models/semantic_models/${folder}`
  const api = `https://api.github.com/repos/${FEDERATED_REPO}/contents/${path}?ref=main`
  const listing = await fetchImpl(api, { headers: { Accept: 'application/vnd.github+json' } })
  let filenames
  if (listing.ok) {
    const files = await listing.json()
    if (!Array.isArray(files)) throw Error('Invalid team model directory response')
    filenames = files.filter(f => f.type === 'file' && /\.ya?ml$/i.test(f.name)).map(f => f.name)
  } else if (listing.status === 403 || listing.status === 429) {
    const fallback = await fetchImpl(`https://data.jsdelivr.com/v1/package/gh/${FEDERATED_REPO}@main/flat`)
    if (!fallback.ok) throw Error(`GitHub rate limited (HTTP ${listing.status}); CDN HTTP ${fallback.status}`)
    const index = await fallback.json()
    const prefix = `/${path}/`
    filenames = (index.files || []).map(f => f.name).filter(name =>
      name.startsWith(prefix) && !name.slice(prefix.length).includes('/') && /\.ya?ml$/i.test(name)
    ).map(name => name.slice(prefix.length))
  } else {
    throw Error(`Cannot list team models: GitHub HTTP ${listing.status}`)
  }
  if (!filenames.length) return []
  const groups = await Promise.all(filenames.map(async name => {
    const filePath = `${path}/${name}`
    const primary = await fetchImpl(`https://raw.githubusercontent.com/${FEDERATED_REPO}/main/${filePath}`)
    const response = primary.ok ? primary : await fetchImpl(`https://cdn.jsdelivr.net/gh/${FEDERATED_REPO}@main/${filePath}`)
    if (!response.ok) throw Error(`Cannot load ${filePath}: HTTP ${response.status}`)
    return parseTeamSemanticFile(await response.text(), filePath, role)
  }))
  return groups.flat()
}
