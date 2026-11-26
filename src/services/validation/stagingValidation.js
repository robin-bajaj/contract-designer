/** Validate unsaved staging SQL only; semantic YAML can still be incomplete. */
export async function validateStagingDraft({role, sourceModel, sourceSql, signal}, fetchImpl=fetch) {
  let response
  try {
    response=await fetchImpl('/api/validate/staging',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      signal,
      body:JSON.stringify({role,sourceModel,sourceMode:'new',sourceSql}),
    })
  } catch(error) {
    if (error?.name==='AbortError') throw error
    throw Error('dbt Core backend unavailable. Start it with npm run dev:api.')
  }
  const payload=await response.json().catch(()=>null)
  if (!payload || typeof payload.ok!=='boolean') throw Error('Unexpected dbt validation response')
  if(response.status===429) return {...payload,busy:true}
  return payload
}
