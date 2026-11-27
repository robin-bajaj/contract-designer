import React, { useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, Clock3, LoaderCircle, XCircle } from 'lucide-react'
import { validateStagingDraft } from '../../services/validation/stagingValidation.js'
import './LiveStagingStatus.css'

const IDENTIFIER=/^[a-z][a-z0-9_]*$/
const DELAY_MS=1400

/** Automatic parse-only feedback for current unsaved Team A/C staging SQL. */
export default function LiveStagingStatus({role,sourceModel,sourceSql}) {
  const signature=useMemo(()=>JSON.stringify([role,sourceModel,sourceSql]),[role,sourceModel,sourceSql])
  const [result,setResult]=useState(null)

  useEffect(()=>{
    if(!IDENTIFIER.test(sourceModel||'')||!sourceSql?.trim()) return
    const controller=new AbortController()
    const timer=setTimeout(async()=>{
      setResult({signature,status:'checking'})
      try {
        const response=await validateStagingDraft({
          role,sourceModel,sourceSql,signal:controller.signal,
        })
        if(controller.signal.aborted) return
        setResult({
          signature,
          status:response.busy?'busy':response.ok?'passed':'failed',
          message:response.error||'',
          log:response.log||'',
          steps:response.steps||[],
        })
      } catch(error) {
        if(controller.signal.aborted) return
        setResult({signature,status:'unavailable',message:error.message})
      }
    },DELAY_MS)
    return ()=>{clearTimeout(timer);controller.abort()}
  },[signature,role,sourceModel,sourceSql])

  const incomplete=!IDENTIFIER.test(sourceModel||'')||!sourceSql?.trim()
  const current=result?.signature===signature?result:null
  const state=incomplete?'idle':current?.status||'pending'
  const statuses={
    idle:{text:!sourceSql?.trim()?'Start typing staging SQL to validate automatically':'Enter a valid SQL model name to validate',Icon:Clock3},
    pending:{text:'Checking after you stop typing…',Icon:Clock3},
    checking:{text:'Checking your staging model…',Icon:LoaderCircle},
    passed:{text:'✓ Staging checks passed',Icon:CheckCircle2},
    failed:{text:'✕ Staging validation failed',Icon:XCircle},
    busy:{text:'Validation service busy — edit SQL to retry',Icon:AlertCircle},
    unavailable:{text:'Validation service unavailable',Icon:AlertCircle},
  }
  const {text:label,Icon}=statuses[state]
  return <div className={`live-staging-status live-staging-${state}`} aria-live="polite" aria-atomic="true">
    <div className="live-staging-heading">
      <Icon size={18} className={state==='checking'?'live-staging-spinning':''} aria-hidden="true"/>
      <strong>{label}</strong>
    </div>
    {state==='passed' && <p>Your model structure passed preliminary checks. SQL execution and column types have <strong>not</strong> been verified.</p>}
    {(state==='failed'||state==='unavailable'||state==='busy') && <>
      {current?.message && <p>{current.message}</p>}
      {current?.log && <details><summary>Show validation error details</summary><pre>{current.log}</pre></details>}
    </>}
    {state==='checking' && <p>Checking the latest edits; nothing is published.</p>}
  </div>
}
