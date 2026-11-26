import { FEDERATED_REPO, teamFolder } from './teamSemanticRegistry.js'

/** Discover SQL source models in a team's staging directory. No dbt Cloud connection needed. */
export async function fetchTeamSourceModels(role, fetchImpl=fetch) {
  const team=teamFolder(role)
  const folder=`models/staging/${team}`
  const response=await fetchImpl(`https://api.github.com/repos/${FEDERATED_REPO}/contents/${folder}?ref=main`,{
    headers:{Accept:'application/vnd.github+json'},
  })
  let names
  if(response.ok) {
    const files=await response.json()
    if(!Array.isArray(files)) throw Error('Invalid SQL model directory response')
    names=files.filter(f=>f.type==='file' && f.name.endsWith('.sql')).map(f=>f.name)
  } else if([403,429].includes(response.status)) {
    const cdn=await fetchImpl(`https://data.jsdelivr.com/v1/package/gh/${FEDERATED_REPO}@main/flat`)
    if(!cdn.ok) throw Error(`Source model listing unavailable (HTTP ${response.status})`)
    const files=await cdn.json()
    const prefix=`/${folder}/`
    names=(files.files||[]).map(f=>f.name).filter(name=>
      name.startsWith(prefix)&&!name.slice(prefix.length).includes('/')&&name.endsWith('.sql'),
    ).map(name=>name.slice(prefix.length))
  } else throw Error(`Cannot list source models: HTTP ${response.status}`)
  return [...new Set(names.map(name=>name.slice(0,-4)))].sort()
}
