import React, { useMemo, useState } from 'react'
import { ArrowLeft, CheckCircle2, Download, Plus, Save, Trash2 } from 'lucide-react'
import {
  createEmptyTeamModel, chooseContract, availableContracts, validateTeamDraft,
  buildTeamModelDocument, toTeamModelYaml,
} from '../../domain/semantics/teamModelAuthoring.js'
import { DATA_TYPES, SIMPLE_AGGREGATIONS } from '../../domain/contracts/dbtOptions.js'
import './TeamModelEditor.css'

const updateIndex=(items,index,patch)=>items.map((item,i)=>i===index?{...item,...patch}:item)
const downloadYaml=(name,text)=>{
  const mime=name.endsWith('.sql')?'text/plain':'text/yaml'
  const url=URL.createObjectURL(new Blob([text],{type:mime}))
  const el=document.createElement('a')
  el.href=url;el.download=name;el.click();URL.revokeObjectURL(url)
}

export default function TeamModelEditor({role,contracts,sourceModels,onBack,onSave,initialDraft}) {
  const [draft,setDraft]=useState(()=>initialDraft ? JSON.parse(JSON.stringify(initialDraft)) : createEmptyTeamModel(role))
  const [error,setError]=useState('')
  const [savedMessage,setSavedMessage]=useState('')
  const selectedAttrs=(draft.attributes||[]).filter(a=>a.selected)
  const expressions=[...new Set([...selectedAttrs.map(a=>a.name),...draft.columns.map(c=>c.name)].filter(Boolean))]
  const issues=useMemo(()=>validateTeamDraft(draft,role,contracts,sourceModels),[draft,role,contracts,sourceModels])
  const generated=useMemo(()=>{
    if (issues.length) return ''
    try{return toTeamModelYaml(buildTeamModelDocument(draft,role,contracts,sourceModels))}
    catch{return ''}
  },[draft,role,contracts,sourceModels,issues])

  const setField=(key,value)=>{setDraft(current=>({...current,[key]:value}));setError('');setSavedMessage('')}
  const changeList=(key,index,patch)=>setField(key,updateIndex(draft[key],index,patch))
  const addList=(key,item)=>setField(key,[...draft[key],item])
  const removeList=(key,index)=>setField(key,draft[key].filter((_,i)=>i!==index))
  const setContract=key=>{
    try{setDraft(current=>chooseContract(current,key,contracts));setError('');setSavedMessage('')}
    catch(err){setError(err.message)}
  }
  const saveDraft=()=>{
    setError('')
    try {
      const saved=onSave(draft)
      setSavedMessage(`Saved locally · ${new Date(saved.savedAt).toLocaleTimeString()}`)
    } catch(error) { setError(error.message) }
  }
  return <div className="team-editor">
    <div className="team-editor-heading">
      <button type="button" className="outline" onClick={onBack}><ArrowLeft size={15}/> Back to models</button>
      <div><span className="team-label">NEW SEMANTIC IMPLEMENTATION</span><h2>Create a team semantic model</h2><p>Author SQL and model properties in this workspace. Drafts stay in your browser until you choose to export them.</p></div>
    </div>

    <div className="team-editor-form team-editor-split-layout">
      <div className="team-editor-fields">
      <section>
        <h3>1. dbt source model</h3>
        <label>Starting point
          <select value={draft.sourceMode} onChange={e=>{setDraft(current=>({...current,sourceMode:e.target.value,sourceModel:'',sourceSql:''}));setSavedMessage('')}}>
            <option value="new">Create a new SQL model</option>
            <option value="existing">Reuse a locally saved team SQL model</option>
          </select>
        </label>
        {draft.sourceMode==='existing' ? <label>Team source model
          <select value={draft.sourceModel} onChange={e=>setField('sourceModel',e.target.value)}>
            <option value="">Choose a model…</option>
            {sourceModels.map(name=><option key={name} value={name}>{name}</option>)}
          </select>
        </label> : <>
          <label>New dbt SQL filename (without .sql)
            <input value={draft.sourceModel} onChange={e=>setField('sourceModel',e.target.value)} placeholder={role==='team-a'?'team_a_new_positions':'team_c_new_positions'}/>
          </label>
          <label>SQL select statement (authored dbt source)
            <textarea value={draft.sourceSql} onChange={e=>setField('sourceSql',e.target.value)} spellCheck={false} rows={7}
              placeholder={`select\n  position_id,\n  report_date,\n  profit_loss,\n  instrument_code\nfrom {{ ref('stg_${role==='team-a'?'team_a':'team_c'}_positions') }}`}/>
          </label>
          <p className="team-editor-note">This is a local SQL draft. dbt Core execution is paused; physical columns and SQL references have not been checked.</p>
        </>}
      </section>

      <section>
        <h3>2. Semantic identity</h3>
        <div className="team-editor-columns">
          <label>Semantic model name<input value={draft.semanticName} onChange={e=>setField('semanticName',e.target.value)} placeholder="team_a_new_positions_semantics"/></label>
          <label>Description<input value={draft.description} onChange={e=>setField('description',e.target.value)} placeholder="Business meaning of this model"/></label>
        </div>
      </section>
      <section>
        <h3>3. CDO contract (optional)</h3>
        <label>Inherit a versioned contract
          <select value={draft.contract} onChange={e=>setContract(e.target.value)}>
            <option value="">Independent team semantic model</option>
            {availableContracts(contracts).map(c=><option value={c.key} key={c.key}>{c.name} · v{c.version}</option>)}
          </select>
        </label>
        {draft.contract && <>
          <h4>Inherited attributes</h4>
          <p className="team-editor-note">CDO defines their names and types. Select what to adopt and optionally add semantic aliases or entity/dimension annotations.</p>
          <div className="team-edit-table"><table><thead><tr><th>Include</th><th>CDO attribute</th><th>Team alias</th><th>Semantic annotation</th></tr></thead><tbody>
            {draft.attributes.map((attr,i)=><tr key={attr.name}>
              <td><input type="checkbox" checked={attr.selected} onChange={e=>changeList('attributes',i,{selected:e.target.checked})}/></td>
              <td>{attr.name}</td>
              <td><input disabled={!attr.selected} value={attr.alias} onChange={e=>changeList('attributes',i,{alias:e.target.value})} placeholder="Optional"/></td>
              <td><select disabled={!attr.selected} value={attr.semanticType} onChange={e=>changeList('attributes',i,{semanticType:e.target.value})}>
                <option value="none">None</option><option value="primary">Primary entity</option><option value="foreign">Foreign entity</option><option value="time">Time dimension</option><option value="categorical">Categorical dimension</option>
              </select></td>
            </tr>)}
          </tbody></table></div>
          <h4>Inherited metrics</h4>
          <div className="team-edit-table"><table><thead><tr><th>Include</th><th>CDO metric</th><th>Team alias</th></tr></thead><tbody>
            {draft.inheritedMetrics.map((metric,i)=><tr key={metric.name}>
              <td><input type="checkbox" checked={metric.selected} onChange={e=>changeList('inheritedMetrics',i,{selected:e.target.checked})}/></td>
              <td>{metric.name}</td>
              <td><input disabled={!metric.selected} value={metric.alias} onChange={e=>changeList('inheritedMetrics',i,{alias:e.target.value})} placeholder="Optional"/></td>
            </tr>)}
          </tbody></table></div>
          <label>Aggregation time dimension
            <select value={draft.aggTimeDimension} onChange={e=>setField('aggTimeDimension',e.target.value)}>
              <option value="">None</option>
              {selectedAttrs.filter(a=>a.semanticType==='time').map(a=><option value={a.name} key={a.name}>{a.name}</option>)}
            </select>
          </label>
        </>}
      </section>
      <section>
        <div className="team-editor-section-heading"><h3>4. Team-owned columns</h3><button type="button" className="outline" onClick={()=>addList('columns',{name:'',data_type:'numeric',description:'',semanticType:'none'})}><Plus size={15}/> Add column</button></div>
        <p className="team-editor-note">Declare only new, team-owned columns. Inherited CDO columns are generated by the compiler.</p>
        <div className="team-edit-table"><table><thead><tr><th>Name</th><th>SQL data type</th><th>Semantic annotation</th><th>Description</th><th></th></tr></thead><tbody>
          {draft.columns.map((c,i)=><tr key={i}>
            <td><input value={c.name} onChange={e=>changeList('columns',i,{name:e.target.value})}/></td>
            <td><select value={c.data_type} onChange={e=>changeList('columns',i,{data_type:e.target.value})}>{DATA_TYPES.map(type=><option key={type}>{type}</option>)}</select></td>
            <td><select value={c.semanticType||'none'} onChange={e=>changeList('columns',i,{semanticType:e.target.value})}><option value="none">None</option><option value="primary">Primary entity</option><option value="foreign">Foreign entity</option><option value="time">Time dimension</option><option value="categorical">Categorical dimension</option></select></td>
            <td><input value={c.description} onChange={e=>changeList('columns',i,{description:e.target.value})}/></td>
            <td><button type="button" className="team-delete" aria-label="Remove column" onClick={()=>removeList('columns',i)}><Trash2 size={15}/></button></td>
          </tr>)}
        </tbody></table></div>
      </section>
      <section>
        <div className="team-editor-section-heading"><h3>5. Team-owned metrics</h3><button type="button" className="outline" onClick={()=>addList('metrics',{name:'',agg:'sum',expr:'',description:''})}><Plus size={15}/> Add metric</button></div>
        <div className="team-edit-table"><table><thead><tr><th>Name</th><th>Aggregation</th><th>Source column</th><th>Description</th><th></th></tr></thead><tbody>
          {draft.metrics.map((m,i)=><tr key={i}>
            <td><input value={m.name} onChange={e=>changeList('metrics',i,{name:e.target.value})}/></td>
            <td><select value={m.agg} onChange={e=>changeList('metrics',i,{agg:e.target.value})}>{SIMPLE_AGGREGATIONS.map(agg=><option key={agg}>{agg}</option>)}</select></td>
            <td><select value={m.expr} onChange={e=>changeList('metrics',i,{expr:e.target.value})}><option value="">Select source…</option>{expressions.map(name=><option key={name}>{name}</option>)}</select></td>
            <td><input value={m.description} onChange={e=>changeList('metrics',i,{description:e.target.value})}/></td>
            <td><button type="button" className="team-delete" aria-label="Remove metric" onClick={()=>removeList('metrics',i)}><Trash2 size={15}/></button></td>
          </tr>)}
        </tbody></table></div>
      </section>
      <section>
        <h3>6. Save and export</h3>
        {issues.length ? <div className="team-validation-errors"><strong>Complete these details to generate a valid YAML file:</strong><ul>{issues.map((issue,i)=><li key={i}>{issue}</li>)}</ul></div>
          : <p className="team-validation-ok"><CheckCircle2 size={16}/> Local structural checks passed. dbt execution is not connected.</p>}
        <div className="team-editor-buttons">
          <button type="button" className="primary" onClick={saveDraft}><Save size={15}/> Save local draft</button>
          <button type="button" className="outline" disabled={draft.sourceMode!=='new'||!draft.sourceSql.trim()} onClick={()=>downloadYaml(`${draft.sourceModel}.sql`,draft.sourceSql)}><Download size={15}/> Download SQL</button>
          <button type="button" className="outline" disabled={!generated} onClick={()=>downloadYaml(`${draft.semanticName}.yml`,generated)}><Download size={15}/> Download YAML</button>
        </div>
        {savedMessage && <p className="team-editor-success" role="status"><CheckCircle2 size={15}/>{savedMessage}</p>}
        {error && <p className="team-editor-error" role="alert">{error}</p>}
        <p className="team-editor-note">Team A/C drafts are not synced to federated-semantic-poc or dbt Studio. Download files as a backup; clearing browser storage removes locally saved drafts.</p>
      </section>
      </div>
      <aside className="team-yaml-preview" aria-label="Live dbt YAML preview">
        <div className="team-yaml-preview-header">
          <div><h3>Live YAML preview</h3><p>{draft.semanticName ? `${draft.semanticName}.yml` : 'New dbt semantic model'}</p></div>
          <div className="team-yaml-preview-actions">
            <button type="button" className="outline" disabled={!generated} onClick={() => navigator.clipboard?.writeText(generated)}>Copy</button>
            <button type="button" className="outline" disabled={!generated} onClick={() => downloadYaml(`${draft.semanticName}.yml`,generated)}><Download size={14}/> Download</button>
          </div>
        </div>
        <pre aria-label="Generated dbt YAML content">{generated||'# Complete valid model details to preview generated YAML.\n# The preview updates as the draft becomes valid.'}</pre>
      </aside>
    </div>
  </div>
}
