import test from 'node:test'
import assert from 'node:assert/strict'
import { registryFilename, publishContractPR } from './githubPublish.js'

test('uses governance registry filenames', () => {
  assert.equal(registryFilename({name:'cdo.position',version:2}), 'contracts/cdo_position_v2.yml')
  assert.throws(() => registryFilename({name:'../../evil',version:1}))
})
test('refuses to overwrite released versions', async () => {
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(url)
    if (url.endsWith('/git/ref/heads/main')) return {ok:true,json:async()=>({object:{sha:'abc'}})}
    return {ok:true,status:200,json:async()=>({})}
  }
  await assert.rejects(publishContractPR({contract:{name:'cdo.position',version:1},yamlText:'test',token:'token',fetchImpl}), /already exists/)
  assert.equal(calls.length,2)
})
test('creates branch, YAML and review PR for a new version', async () => {
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({url,options})
    if (url.endsWith('/git/ref/heads/main')) return {ok:true,json:async()=>({object:{sha:'abc'}})}
    if (url.includes('/contents/') && options.method !== 'PUT') return {ok:false,status:404,json:async()=>({message:'Not Found'})}
    if (url.endsWith('/pulls')) return {ok:true,json:async()=>({html_url:'https://github.com/pull/123',number:123})}
    return {ok:true,json:async()=>({})}
  }
  const result = await publishContractPR({contract:{name:'cdo.position',version:2},yamlText:'name: cdo.position',token:'token',fetchImpl})
  assert.equal(result.number,123)
  assert.equal(calls.filter(c=>c.options.method === 'POST').length,2)
  assert.ok(calls.some(c=>c.options.method === 'PUT' && c.url.includes('cdo_position_v2.yml')))
})
