/** Team-provided dbt details go only to the loopback Python backend.
 * Service tokens are kept in component memory, not browser storage or URLs.
 */
async function call(url,{data=null,fetchImpl=fetch}={}) {
  let response
  try {
    response=await fetchImpl(url,{
      method:data!==null?'POST':'GET',
      headers:{
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
export const leadDiscoverProjects=(details,fetchImpl=fetch)=>
  call('/api/lead/dbt/projects',{data:details,fetchImpl})
export const leadPreviewProject=(details,fetchImpl=fetch)=>
  call('/api/lead/dbt/preview',{data:details,fetchImpl})
export const leadConnectProject=(details,fetchImpl=fetch)=>
  call('/api/lead/dbt/connect',{data:details,fetchImpl})

export const teamConnectedModels=(role,fetchImpl=fetch)=>
  call(`/api/team-models/connected?role=${encodeURIComponent(role)}`,{fetchImpl})
export const teamConnectedFile=(role,path,fetchImpl=fetch)=>
  call(`/api/team-models/file?role=${encodeURIComponent(role)}&path=${encodeURIComponent(path)}`,{fetchImpl})
