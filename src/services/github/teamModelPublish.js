import { FEDERATED_REPO } from './teamSemanticRegistry.js'
import { teamModelPath, teamSourcePath } from '../../domain/semantics/teamModelAuthoring.js'

function encodeUtf8(content) {
  const bytes=new TextEncoder().encode(content)
  let binary=''
  for(const byte of bytes) binary+=String.fromCharCode(byte)
  return btoa(binary)
}

/** Prototype: token stays in UI memory. A backend GitHub App is required for production. */
export async function publishTeamModelPR({role,semanticName,yamlText,sourceModel,sourceSql,token,fetchImpl=fetch}) {
  if (!token?.trim()) throw Error('Enter a fine-grained GitHub token to create a PR.')
  const path=teamModelPath(role,semanticName)
  const api=`https://api.github.com/repos/${FEDERATED_REPO}`
  const headers={
    Authorization:`Bearer ${token.trim()}`,
    Accept:'application/vnd.github+json',
    'X-GitHub-Api-Version':'2022-11-28',
  }
  async function request(url,options={}) {
    const response=await fetchImpl(url,{
      ...options,
      headers:{...headers,...(options.body?{'Content-Type':'application/json'}:{})},
    })
    const body=await response.json().catch(()=>({}))
    if(!response.ok) throw Error(`GitHub HTTP ${response.status}: ${body.message||'Request failed'}`)
    return body
  }
  // Both files must be absent from main. Do not overwrite team-authored SQL/YAML.
  const changes=[{path,content:yamlText}]
  if (sourceSql != null) changes.push({path:teamSourcePath(role,sourceModel),content:sourceSql})
  for (const file of changes) {
    const exists=await fetchImpl(`${api}/contents/${file.path}?ref=main`,{headers})
    if (exists.status!==404) {
      if (exists.ok) throw Error(`${file.path} already exists on main. Choose a new filename.`)
      const body=await exists.json().catch(()=>({}))
      throw Error(`Cannot verify ${file.path}: GitHub HTTP ${exists.status} ${body.message||''}`)
    }
  }
  const base=await request(`${api}/git/ref/heads/main`)
  const branch=`semantic-designer/${role}/${semanticName}-${Date.now().toString(36)}`
  await request(`${api}/git/refs`,{method:'POST',body:JSON.stringify({ref:`refs/heads/${branch}`,sha:base.object.sha})})
  for(const file of changes) {
    await request(`${api}/contents/${file.path}`,{method:'PUT',body:JSON.stringify({
      branch,content:encodeUtf8(file.content),message:`feat(${role}): add ${file.path.split('/').pop()}`,
    })})
  }
  const pr=await request(`${api}/pulls`,{method:'POST',body:JSON.stringify({
    base:'main',head:branch,title:`[${role}] New semantic model: ${semanticName}`,
    body:`New authored semantic model proposed by the Semantic Governance Portal.\n\nFile: \`${path}\`\n\nPlease review team ownership, inheritance, compilation and dbt parse/build checks. No direct deployment occurs from the browser.`,
  })})
  return {url:pr.html_url,number:pr.number,branch,path,files:changes.map(file=>file.path)}
}
