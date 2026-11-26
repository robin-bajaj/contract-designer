/** Calls the local dbt Core development backend through Vite's same-origin proxy. */
export async function fastValidateTeamModel({
  role, sourceModel, semanticName, sourceMode, sourceSql, yamlText,
}, fetchImpl=fetch) {
  const payload = {
    role, sourceModel, semanticName, sourceMode,
    sourceSql: sourceMode === 'new' ? sourceSql : null,
    yamlText,
  }
  let response
  try {
    response = await fetchImpl('/api/validate/fast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch (error) {
    throw Error('Cannot reach the local dbt Core validation backend. Start it with npm run dev:api.')
  }
  const result = await response.json().catch(() => null)
  if (!result || typeof result.ok !== 'boolean') {
    throw Error('Invalid dbt Core backend response. Confirm npm run dev:api is running.')
  }
  return result
}
