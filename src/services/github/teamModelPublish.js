import { FEDERATED_REPO } from './teamSemanticRegistry.js'
import { teamModelPath } from '../../domain/semantics/teamModelAuthoring.js'

function encodeUtf8(content) {
  const bytes=new TextEncoder().encode(content)
  let binary=''
  for(const byte of bytes) binary+=String.fromCharCode(byte)
  return btoa(binary)
}

/** Prototype: token stays in UI memory. A backend GitHub App is required for production. */
export async function publishTeamModelPR({role,semanticName,yamlText,token,fetchImpl=fetch}) {
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
  // A new model is a new YAML file. Never overwrite existing team definitions.
  const exists=await fetchImpl(`${api}/contents/${path}?ref=main`,{headers})
  if(exists.status!==404) {
    if(exists.ok) throw Error(`${path} already exists. Choose a different semantic model name.`)
    const body=await exists.json().catch(()=>({}))
    throw Error(`Could not verify existing model: GitHub HTTP ${exists.status} ${body.message||''}`)
  }
  const base=await request(`${api}/git/ref/heads/main`)
  const branch=`semantic-designer/${role}/${semanticName}-${Date.now().toString(36)}`
  await request(`${api}/git/refs`,{method:'POST',body:JSON.stringify({ref:`refs/heads/${branch}`,sha:base.object.sha})})
  await request(`${api}/contents/${path}`,{method:'PUT',body:JSON.stringify({
    branch,content:encodeUtf8(yamlText),message:`feat(${role}): add ${semanticName} semantic model`,
  })})
  const pr=await request(`${api}/pulls`,{method:'POST',body:JSON.stringify({
    base:'main',head:branch,title:`[${role}] New semantic model: ${semanticName}`,
    body:`New authored semantic model proposed by the Semantic Governance Portal.\n\nFile: \`${path}\`\n\nPlease review team ownership, inheritance, compilation and dbt parse/build checks. No direct deployment occurs from the browser.`,
  })})
  return {url:pr.html_url,number:pr.number,branch,path}
}
