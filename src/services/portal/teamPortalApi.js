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

export const savePortalDraft=(draft,fetchImpl=fetch)=>
  request('/api/team-models/save','POST',draft,fetchImpl).then(result=>result.draft)

export const validatePortalDraft=(id,fetchImpl=fetch)=>
  request('/api/team-models/validate','POST',{id},fetchImpl)

export const publishPortalDraft=(id,fetchImpl=fetch)=>
  request('/api/team-models/publish','POST',{id},fetchImpl)

export const dbtBackendStatus=(fetchImpl=fetch)=>
  request('/api/dbt/status','GET',null,fetchImpl)
