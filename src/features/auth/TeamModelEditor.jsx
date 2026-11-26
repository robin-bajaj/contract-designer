import React, { useMemo, useState } from 'react'
import { ArrowLeft, CheckCircle2, Download, GitPullRequest, Plus, Trash2, PlayCircle, AlertCircle } from 'lucide-react'
import {
  createEmptyTeamModel, chooseContract, availableContracts, validateTeamDraft,
  buildTeamModelDocument, toTeamModelYaml, teamModelPath,
} from '../../domain/semantics/teamModelAuthoring.js'
import { DATA_TYPES, SIMPLE_AGGREGATIONS } from '../../domain/contracts/dbtOptions.js'
import { publishTeamModelPR } from '../../services/github/teamModelPublish.js'
import { fastValidateTeamModel } from '../../services/validation/dbtCoreValidation.js'
import './TeamModelEditor.css'

const updateIndex=(items,index,patch)=>items.map((item,i)=>i===index?{...item,...patch}:item)
const downloadYaml=(name,text)=>{
  const url=URL.createObjectURL(new Blob([text],{type:'text/yaml'}))
  const el=document.createElement('a')
  el.href=url;el.download=name;el.click();URL.revokeObjectURL(url)
}

export default function TeamModelEditor({role,contracts,sourceModels,onBack}) {
  const [draft,setDraft]=useState(()=>createEmptyTeamModel(role))
  const [token,setToken]=useState('')
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
    try{setDraft(current=>chooseContract(current,key,contracts));setError('');setResult(null)}
    catch(err){setError(err.message)}
  }
  const validateStaging=async()=>{
    setError('')
    setValidationResult(null)
    if(issues.length || !generated) {setError('Resolve local structural issues before running dbt Core.');return}
    setValidating(true)
    const signature=JSON.stringify([role,draft.sourceModel,draft.semanticName,draft.sourceMode,draft.sourceSql,generated])
    try {
      const response=await fastValidateTeamModel({
        role,sourceModel:draft.sourceModel,semanticName:draft.semanticName,
        sourceMode:draft.sourceMode,sourceSql:draft.sourceSql,yamlText:generated,
      })
      setValidationResult({ ...response,signature })
    } catch(err) {setValidationResult({ok:false,error:err.message,steps:[],log:'',signature})}
    finally {setValidating(false)}
  }
  const publish=async()=>{
    setError('');setResult(null)
    if(issues.length){setError(issues.join(' · '));return}
    if(!token.trim()){setError('Enter a fine-grained GitHub token with Contents and Pull requests read/write on federated-semantic-poc.');return}
    setPublishing(true)
    try{
      const pr=await publishTeamModelPR({
        role,semanticName:draft.semanticName,yamlText:generated,
        sourceModel:draft.sourceModel,
        sourceSql:draft.sourceMode==='new'?draft.sourceSql:null,
        token,
      })
      setResult(pr)
    }catch(err){setError(err.message)}
    finally{setPublishing(false)}
  }
  return <div className="team-editor">
    <div className="team-editor-heading">
      <button type="button" className="outline" onClick={onBack}><ArrowLeft size={15}/> Back to models</button>
      <div><span className="team-label">NEW SEMANTIC IMPLEMENTATION</span><h2>Create a team semantic model</h2><p>Author SQL and model properties without editing CDO-owned definitions. Proposed changes go through a pull request.</p></div>
    </div>

    <div className="team-editor-form">
      <section>
        <h3>1. dbt source model</h3>
        <label>Starting point
          <select value={draft.sourceMode} onChange={e=>{setDraft(current=>({...current,sourceMode:e.target.value,sourceModel:'',sourceSql:''}));setResult(null);setValidationResult(null)}}>
            <option value="new">Create a new SQL model</option>
            <option value="existing">Use an existing team SQL model</option>
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
          <p className="team-editor-note">New source SQL will be reviewed through GitHub and compiled by dbt CI. Its physical columns must match your declared contract fields.</p>
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
        <h3>6. Validate and propose through GitHub</h3>
        {issues.length?<div className="team-validation-errors"><strong>Resolve these before publishing:</strong><ul>{issues.map((issue,i)=><li key={i}>{issue}</li>)}</ul></div>
          : <p className="team-validation-ok"><CheckCircle2 size={16}/> Local structural checks passed. dbt CI remains authoritative.</p>}
        <label>Fine-grained GitHub token (not stored)
          <input type="password" autoComplete="off" value={token} onChange={e=>setToken(e.target.value)} placeholder="Token with Contents and Pull requests read/write"/>
        </label>
        <div className="team-editor-buttons">
          <button type="button" className="outline" disabled={!generated||validating} onClick={validateStaging}>
            <PlayCircle size={15}/>{validating?'Validating in dbt Core…':'Validate Staging (dbt Core)'}
          </button>
          <button type="button" className="outline" disabled={!generated} onClick={()=>downloadYaml(`${draft.semanticName}.yml`,generated)}><Download size={15}/> Download YAML</button>
          <button type="button" className="primary" disabled={issues.length>0||publishing||!token.trim()} onClick={publish}>
            <GitPullRequest size={15}/>{publishing?'Creating PR…':'Save to GitHub (PR)'}
          </button>
        </div>
        {validationResult && <div className={`team-dbt-results ${validationResult.ok?'passed':'failed'}`} role="status">
          <h4>{validationResult.ok?<CheckCircle2 size={17}/>:<AlertCircle size={17}/>}
            {validationResult.ok?'dbt Core fast validation passed':'dbt Core fast validation did not pass'}</h4>
          {validationResult.error && <p>{validationResult.error}</p>}
          {validationResult.steps?.length>0 && <ul>{validationResult.steps.map((step,index)=><li key={index}>
            {step.status==='passed'?<CheckCircle2 size={14}/>:<AlertCircle size={14}/>}
            {step.name} — {step.status}
          </li>)}</ul>}
          {validationResult.log && <details><summary>dbt / compiler output</summary><pre>{validationResult.log}</pre></details>}
          <small>Parse-only: does not execute SQL, inspect Neon columns, or enforce physical database contracts.</small>
        </div>}
        {error && <p className="team-editor-error" role="alert">{error}</p>}
        {result && <p className="team-editor-success"><CheckCircle2 size={15}/> PR #{result.number} created. <a href={result.url} target="_blank" rel="noopener noreferrer">Open for review</a></p>}
        <p className="team-editor-note">The PR targets federated-semantic-poc/main. It does not run dbt Cloud immediately or deploy your model. CI validates the compiled project.</p>
      </section>
      <section className="team-yaml-preview"><h3>Generated dbt YAML preview</h3><pre>{generated||'# Complete valid model details to preview generated YAML.'}</pre></section>
    </div>
  </div>
}
