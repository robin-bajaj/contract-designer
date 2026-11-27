/** Backend-owned dbt integrations. Tokens stay on Python server.
 * Admin unlock key is held only in React component memory for this session.
 */
async function call(url,{method='GET',data=null,adminKey=null,fetchImpl=fetch}={}) {
  let response
  try {
    response=await fetchImpl(url,{
      method,
      headers:{
        ...(adminKey!==null?{'X-Portal-Admin-Key':adminKey}:{}),
        ...(data!==null?{'Content-Type':'application/json'}:{}),
      },
      ...(data!==null?{body:JSON.stringify(data)}:{}),
    })
  } catch {
    throw Error('The portal backend is unavailable.')
  }
  const result=await response.json().catch(()=>null)
  if(!response.ok || !result) throw Error(result?.error||`Backend HTTP ${response.status}`)
  return result
}
export const adminProjects=(key,fetchImpl=fetch)=>
  call('/api/admin/project-connections/projects',{adminKey:key,fetchImpl})
export const adminProjectPreview=(key,id,fetchImpl=fetch)=>
  call(`/api/admin/project-connections/preview?projectId=${encodeURIComponent(id)}`,{adminKey:key,fetchImpl})
export const adminAssignProject=(key,role,projectId,environmentId,fetchImpl=fetch)=>
  call('/api/admin/project-connections',{method:'POST',data:{role,projectId,environmentId},adminKey:key,fetchImpl})
export const teamConnectedModels=(role,fetchImpl=fetch)=>
  call(`/api/team-models/connected?role=${encodeURIComponent(role)}`,{fetchImpl})
export const teamConnectedFile=(role,path,fetchImpl=fetch)=>
  call(`/api/team-models/file?role=${encodeURIComponent(role)}&path=${encodeURIComponent(path)}`,{fetchImpl})
