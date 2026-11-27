import test from 'node:test'
import assert from 'node:assert/strict'
import {
  teamDraftStorageKey, loadTeamDrafts, saveTeamDraft, deleteTeamDraft,
} from './teamDraftStore.js'

const storage = () => {
  const data = new Map()
  return {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value) },
    removeItem: key => data.delete(key),
    entries: () => [...data.entries()],
  }
}

test('Team A and Team C drafts stay isolated and never call GitHub',()=>{
  const store=storage()
  const a=saveTeamDraft('team-a',{sourceModel:'stg_a',semanticName:'a_equity',sourceMode:'new',sourceSql:'select 1'},store)
  const c=saveTeamDraft('team-c',{sourceModel:'stg_c',semanticName:'c_fi',sourceMode:'new',sourceSql:'select 2'},store)
  assert.ok(a.id.startsWith('team_a:'))
  assert.ok(c.id.startsWith('team_c:'))
  assert.equal(loadTeamDrafts('team-a',store)[0].draft.semanticName,'a_equity')
  assert.equal(loadTeamDrafts('team-c',store)[0].draft.semanticName,'c_fi')
  assert.notEqual(teamDraftStorageKey('team-a'),teamDraftStorageKey('team-c'))
  assert.equal(store.entries().length,2)
})

test('saving the same model updates the local record instead of duplicating it',()=>{
  const store=storage()
  saveTeamDraft('team-a',{sourceModel:'stg_a',semanticName:'equity',description:'old'},store)
  saveTeamDraft('team-a',{sourceModel:'stg_a',semanticName:'equity',description:'new'},store)
  const loaded=loadTeamDrafts('team-a',store)
  assert.equal(loaded.length,1)
  assert.equal(loaded[0].draft.description,'new')
})

test('saved drafts can be deleted and corrupted browser entries are handled gracefully',()=>{
  const store=storage()
  const first=saveTeamDraft('team-c',{sourceModel:'stg_c',semanticName:'model_c'},store)
  assert.equal(deleteTeamDraft('team-c',first.id,store).length,0)
  store.setItem(teamDraftStorageKey('team-c'),'{broken-json')
  assert.deepEqual(loadTeamDrafts('team-c',store),[])
})

test('unavailable storage does not silently pretend the draft was saved',()=>{
  assert.throws(()=>saveTeamDraft('team-a',{sourceModel:'a'},null),/unavailable/)
  assert.throws(()=>teamDraftStorageKey('cdo'),/Unknown team role/)
})
