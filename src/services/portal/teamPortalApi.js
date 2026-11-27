/** Portal-owned Team A/C drafts. No calls to federated-semantic-poc. */
async function request(url, method='GET', data=null, fetchImpl=fetch) {
  let response
  try {
    response=await fetchImpl(url,{
      method,
      ...(data!==null?{headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}:{}),
    })
  } catch {
    throw Error('Python backend is unavailable. Start npm run dev:api.')
  }
  const result=await response.json().catch(()=>null)
  if (!response.ok || !result) throw Error(result?.error||`Backend HTTP ${response.status}`)
  return result
}

export const listPortalModels=(role,fetchImpl=fetch)=>
  request(`/api/team-models?role=${encodeURIComponent(role)}`,'GET',null,fetchImpl)
    .then(result=>result.models)

export const listPortalSources=(role,fetchImpl=fetch)=>
  request(`/api/team-models/sources?role=${encodeURIComponent(role)}`,'GET',null,fetchImpl)
    .then(result=>result.sources)

export const deletePortalDraft=(id,role,fetchImpl=fetch)=>
  request('/api/team-models/delete','POST',{id,role},fetchImpl)

export const savePortalDraft=(draft,fetchImpl=fetch)=>
  request('/api/team-models/save','POST',draft,fetchImpl).then(result=>result.draft)

export async function validatePortalDraft(id,fetchImpl=fetch) {
  let response
  try {
    response=await fetchImpl('/api/team-models/validate',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id}),
    })
  } catch { throw Error('Python backend is unavailable. Start npm run dev:api.') }
  const result=await response.json().catch(()=>null)
  // HTTP 422 means dbt parsing/compilation failed: return detailed steps/logs.
  if(response.status===422 && typeof result?.ok==='boolean') return result
  if(!response.ok||!result) throw Error(result?.error||`Backend HTTP ${response.status}`)
  return result
}

export const publishPortalDraft=(id,fetchImpl=fetch)=>
  request('/api/team-models/publish','POST',{id},fetchImpl)

export const dbtBackendStatus=(fetchImpl=fetch)=>
  request('/api/dbt/status','GET',null,fetchImpl)
