/** Team Lead-supplied dbt details are sent only to the local Python backend.
 * The lead's access code and service token are kept in component memory,
 * never persisted to browser storage or placed in a query string.
 */
async function call(url,{data=null,leadKey=null,fetchImpl=fetch}={}) {
  let response
  try {
    response=await fetchImpl(url,{
      method:data!==null?'POST':'GET',
      headers:{
        ...(leadKey!==null?{'X-Portal-Lead-Key':leadKey}:{}),
        ...(data!==null?{'Content-Type':'application/json'}:{}),
      },
      ...(data!==null?{body:JSON.stringify(data)}:{}),
      cache:'no-store',
    })
  } catch {
    throw Error('The portal backend is unavailable.')
  }
  const result=await response.json().catch(()=>null)
  if(!response.ok || !result) throw Error(result?.error||`Backend HTTP ${response.status}`)
  return result
}
export const leadDiscoverProjects=(leadKey,details,fetchImpl=fetch)=>
  call('/api/lead/dbt/projects',{data:details,leadKey,fetchImpl})
export const leadPreviewProject=(leadKey,details,fetchImpl=fetch)=>
  call('/api/lead/dbt/preview',{data:details,leadKey,fetchImpl})
export const leadConnectProject=(leadKey,details,fetchImpl=fetch)=>
  call('/api/lead/dbt/connect',{data:details,leadKey,fetchImpl})

export const teamConnectedModels=(role,fetchImpl=fetch)=>
  call(`/api/team-models/connected?role=${encodeURIComponent(role)}`,{fetchImpl})
export const teamConnectedFile=(role,path,fetchImpl=fetch)=>
  call(`/api/team-models/file?role=${encodeURIComponent(role)}&path=${encodeURIComponent(path)}`,{fetchImpl})
