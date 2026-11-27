import React, { useMemo, useState } from 'react'
import { ArrowLeft, CheckCircle2, Download, Save, Rocket, Plus, Trash2, PlayCircle, AlertCircle } from 'lucide-react'
import {
  createEmptyTeamModel, chooseContract, availableContracts, validateTeamDraft,
  buildTeamModelDocument, toTeamModelYaml, teamModelPath,
} from '../../domain/semantics/teamModelAuthoring.js'
import { DATA_TYPES, SIMPLE_AGGREGATIONS } from '../../domain/contracts/dbtOptions.js'
import { savePortalDraft, validatePortalDraft, publishPortalDraft } from '../../services/portal/teamPortalApi.js'
import LiveStagingStatus from './LiveStagingStatus.jsx'
import './TeamModelEditor.css'

const updateIndex=(items,index,patch)=>items.map((item,i)=>i===index?{...item,...patch}:item)
const downloadYaml=(name,text)=>{
  const url=URL.createObjectURL(new Blob([text],{type:'text/yaml'}))
  const el=document.createElement('a')
  el.href=url;el.download=name;el.click();URL.revokeObjectURL(url)
}

export default function TeamModelEditor({role,contracts,sourceModels,onBack,initialDraft=null}) {
  const [draft,setDraft]=useState(()=>initialDraft?.draftData && Object.keys(initialDraft.draftData).length ? initialDraft.draftData : createEmptyTeamModel(role))
  const [saved,setSaved]=useState(initialDraft)
  const [validatedSignature,setValidatedSignature]=useState(initialDraft?.status==='validated'?null:null)
  const [saving,setSaving]=useState(false)
  const [publishing,setPublishing]=useState(false)
  const [result,setResult]=useState(null)
  const [error,setError]=useState('')
  const [validating,setValidating]=useState(false)
  const [validationResult,setValidationResult]=useState(null)
  const selectedAttrs=(draft.attributes||[]).filter(a=>a.selected)
  const expressions=[...new Set([...selectedAttrs.map(a=>a.name),...draft.columns.map(c=>c.name)].filter(Boolean))]
  const issues=useMemo(()=>validateTeamDraft(draft,role,contracts,sourceModels),[draft,role,contracts,sourceModels])
  const generated=useMemo(()=>{
    if (issues.length) return ''
    try{return toTeamModelYaml(buildTeamModelDocument(draft,role,contracts,sourceModels))}
    catch{return ''}
  },[draft,role,contracts,sourceModels,issues])

  const setField=(key,value)=>{setDraft(current=>({...current,[key]:value}));setError('');setResult(null);setValidationResult(null)}
  const changeList=(key,index,patch)=>setField(key,updateIndex(draft[key],index,patch))
  const addList=(key,item)=>setField(key,[...draft[key],item])
  const removeList=(key,index)=>setField(key,draft[key].filter((_,i)=>i!==index))
  const setContract=key=>{
    try{setDraft(current=>chooseContract(current,key,contracts));setError('');setResult(null);setValidatedSignature(null)}
    catch(err){setError(err.message)}
  }
  const snapshot=JSON.stringify([role,draft.sourceModel,draft.semanticName,draft.sourceMode,draft.sourceSql,generated])
  const draftPayload=()=>({
    id:saved?.id,role,sourceModel:draft.sourceModel,semanticName:draft.semanticName,
    sourceMode:draft.sourceMode,sourceSql:draft.sourceMode==='new'?draft.sourceSql:null,
    yamlText:generated,draftData:draft,
  })
  const saveDraft=async()=>{
    setError('')
    setSaving(true)
    try{
      const result=await savePortalDraft(draftPayload())
      setSaved(result)
      setResult(null)
      return result
    }catch(err){setError(err.message);return null}
    finally{setSaving(false)}
  }
  const validateStaging=async()=>{
    setError('')
    setValidationResult(null)
    if(issues.length||!generated){
      setError('Complete the semantic model and resolve local issues before dbt Core validation.')
      return
    }
    setValidating(true)
    try{
      const current=await savePortalDraft(draftPayload())
      setSaved(current)
      const response=await validatePortalDraft(current.id)
      setValidationResult(response)
      if(response.ok) {
        setValidatedSignature(response.validationRevision ? snapshot : null)
        setSaved(response.draft)
      }else setValidatedSignature(null)
    }catch(err){
      setValidationResult({ok:false,error:err.message,steps:[],log:''})
      setValidatedSignature(null)
    }finally{setValidating(false)}
  }
  const publish=async()=>{
    if(!saved?.id||validatedSignature!==snapshot){
      setError('Run successful dbt Core validation for this exact draft before publishing.')
      return
    }
    setPublishing(true)
    setError('')
    try{
      const output=await publishPortalDraft(saved.id)
      setResult(output)
      setSaved({...saved,status:'submitted',prUrl:output.prUrl,prNumber:output.prNumber})
    }catch(err){setError(err.message)}
    finally{setPublishing(false)}
  }
  return <div className="team-editor">
    <div className="team-editor-heading">
      <button type="button" className="outline" onClick={onBack}><ArrowLeft size={15}/> Back to models</button>
      <div><span className="team-label">NEW SEMANTIC IMPLEMENTATION</span><h2>Create a team semantic model</h2><p>Create a staging model, inherit approved CDO definitions, and validate your model—all here.</p></div>
    </div>

    <div className="team-editor-form team-editor-split-layout">
      <div className="team-editor-fields">
      <section>
        <h3>1. Staging model</h3>
        <label>Starting point
          <select value={draft.sourceMode} onChange={e=>{setDraft(current=>({...current,sourceMode:e.target.value,sourceModel:'',sourceSql:''}));setResult(null);setValidationResult(null)}}>
            <option value="new">Create a new staging model</option>
            <option value="existing">Use an existing team SQL model</option>
          </select>
        </label>
        {draft.sourceMode==='existing' ? <label>Team source model
          <select value={draft.sourceModel} onChange={e=>setField('sourceModel',e.target.value)}>
            <option value="">Choose a model…</option>
            {sourceModels.map(name=><option key={name} value={name}>{name}</option>)}
          </select>
        </label> : <>
          <label>Staging model name
            <input value={draft.sourceModel} onChange={e=>setField('sourceModel',e.target.value)} placeholder={role==='team-a'?'team_a_new_positions':'team_c_new_positions'}/>
          </label>
          <label>Staging SQL editor
            <textarea value={draft.sourceSql} onChange={e=>setField('sourceSql',e.target.value)} spellCheck={false} rows={7}
              placeholder={`select\n  'EQ-001'::text as position_id,\n  current_date as report_date,\n  150.25::numeric as profit_loss,\n  125.50::numeric as mtm,\n  50.00::numeric as cash,\n  1001::integer as instrument_code`}/>
          </label>
          <LiveStagingStatus role={role} sourceModel={draft.sourceModel} sourceSql={draft.sourceSql}/>
          <p className="team-editor-note">Start with a standalone SELECT, or use <code>{'{{ ref(\'model_name\') }}'}</code> only for a model already published in this portal. Models in the paused federated repository are not available here. Checks do not execute SQL.</p>
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
        <h3>6. Save, validate and publish</h3>
        {issues.length?<div className="team-validation-errors"><strong>Resolve these before publishing:</strong><ul>{issues.map((issue,i)=><li key={i}>{issue}</li>)}</ul></div>
          : <p className="team-validation-ok"><CheckCircle2 size={16}/> Initial form checks passed. Run validation before publishing.</p>}
        <p className="team-editor-note">Save your draft locally, validate with the CDO compiler and dbt Core, then create a GitHub pull request. Connect GitHub with Contents and Pull requests write permissions in Team Lead: Manage connections first.</p>
        <div className="team-editor-buttons">
          <button type="button" className="outline" disabled={saving||validating} onClick={saveDraft}><Save size={15}/>{saving?'Saving…':'Save Draft'}</button>
          <button type="button" className="outline" disabled={!generated||validating} onClick={validateStaging}>
            <PlayCircle size={15}/>{validating?'Validating…':'Validate Model'}
          </button>
          <button type="button" className="outline" disabled={!generated} onClick={()=>downloadYaml(`${draft.semanticName}.yml`,generated)}><Download size={15}/> Download YAML</button>
          <button type="button" className="primary" disabled={publishing||!saved?.id||validatedSignature!==snapshot} onClick={publish}>
            <Rocket size={15}/>{publishing?'Creating pull request…':'Create GitHub PR'}
          </button>
        </div>
        {validationResult && <div className={`team-dbt-results ${validationResult.ok?'passed':'failed'}`} role="status">
          <h4>{validationResult.ok?<CheckCircle2 size={17}/>:<AlertCircle size={17}/>}
            {validationResult.ok?'Model validation passed':'Model validation did not pass'}</h4>
          {validationResult.error && <p>{validationResult.error}</p>}
          {validationResult.ok && !validationResult.validationRevision && <p>Local-only validation passed. Connect this team to a dbt Cloud project and validate against its complete GitHub repository before creating a pull request.</p>}
          {validationResult.validationRevision && <p>Validated against connected Git revision {validationResult.validationRevision.slice(0,12)}.</p>}
          {validationResult.hint && <p className="team-validation-hint">{validationResult.hint}</p>}
          {validationResult.steps?.length>0 && <ul>{validationResult.steps.map((step,index)=><li key={index}>
            {step.status==='passed'?<CheckCircle2 size={14}/>:<AlertCircle size={14}/>}
            {step.name} — {step.status}
          </li>)}</ul>}
          {validationResult.log && <details><summary>dbt / compiler output</summary><pre>{validationResult.log}</pre></details>}
          <small>Validation checks model structure and references; it does not execute SQL or verify physical column types.</small>
        </div>}
        {saved?.id && <p className="team-validation-ok"><Save size={14}/> Draft saved to portal · {saved.status}{saved.prUrl && <> · <a href={saved.prUrl} target="_blank" rel="noopener noreferrer">GitHub PR #{saved.prNumber}</a></>}</p>}
        {error && <p className="team-editor-error" role="alert">{error}</p>}
        {result && <div className="team-editor-success"><CheckCircle2 size={15}/>
          <span>{result.message} <a href={result.prUrl} target="_blank" rel="noopener noreferrer">View PR #{result.prNumber} on GitHub</a>
          <small>{result.paths?.join(', ')}</small></span>
        </div>}
        <p className="team-editor-note">Publishing creates a feature branch and pull request in the connected GitHub repository. Nothing is merged into main until GitHub reviews and required CI checks pass.</p>
      </section>
      </div>
      <aside className="team-yaml-preview" aria-label="Live dbt YAML preview">
        <div className="team-yaml-preview-header">
          <div><h3>Live YAML preview</h3><p>{draft.semanticName ? `${draft.semanticName}.yml` : 'New semantic model'}</p></div>
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
