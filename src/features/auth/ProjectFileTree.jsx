import React, { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, FileCode2, FileJson, FileText, Folder, FolderOpen, Plus, Search } from 'lucide-react'

function makeTree(paths) {
  const root = { name: '', folders: new Map(), files: [] }
  for (const path of paths) {
    const parts = path.split('/').filter(Boolean)
    let node = root
    for (const part of parts.slice(0, -1)) {
      if (!node.folders.has(part)) node.folders.set(part, {name: part, folders: new Map(), files: []})
      node = node.folders.get(part)
    }
    node.files.push({name: parts.at(-1), path})
  }
  return root
}

function TreeFolder({node,depth=0,filterActive,onOpen,onCreate}) {
  const [expanded,setExpanded] = useState(depth < 2)
  const isOpen = filterActive || expanded
  return <div>
    {depth > 0 && <div className="dbt-tree-row" style={{paddingLeft: 8 + (depth-1)*17}}>
      <button className="dbt-tree-folder" onClick={()=>setExpanded(v=>!v)} aria-expanded={isOpen}>
        {isOpen?<ChevronDown size={14}/>:<ChevronRight size={14}/>}
        {isOpen?<FolderOpen size={15}/>:<Folder size={15}/>}
        <span>{node.name}</span>
      </button>
      <button type="button" className="dbt-tree-add" title={'Create local model draft (folder: '+node.name+')'} onClick={onCreate}><Plus size={13}/></button>
    </div>}
    {isOpen && <>
      {[...node.folders.values()].sort((a,b)=>a.name.localeCompare(b.name)).map(child=>
        <TreeFolder key={child.name} node={child} depth={depth+1} filterActive={filterActive} onOpen={onOpen} onCreate={onCreate}/>)}
      {node.files.sort((a,b)=>a.name.localeCompare(b.name)).map(file=>
        <button key={file.path} type="button" className="dbt-tree-file" style={{paddingLeft:8+depth*17}}
          onClick={()=>onOpen(file.path)} title={'Open '+file.path}>
          {/\.(yml|yaml|json)$/.test(file.name)?<FileJson size={15}/>: /\.(sql|py|sh)$/.test(file.name)?<FileCode2 size={15}/>:<FileText size={15}/>}
          <span>{file.name}</span><span className="dbt-tree-open">Open</span>
        </button>)}
    </>}
  </div>
}

export default function ProjectFileTree({paths=[],onOpen,onCreate}) {
  const [search,setSearch] = useState('')
  const [filter,setFilter] = useState('all')
  const visible = useMemo(()=>paths.filter(path=>
    path.toLowerCase().includes(search.trim().toLowerCase()) &&
    (filter === 'all' || (filter === 'sql' ? path.endsWith('.sql') :
      filter === 'yaml' ? /\.(yml|yaml)$/.test(path) : true))
  ),[paths,search,filter])
  const tree=useMemo(()=>makeTree(visible),[visible])
  return <div className="dbt-explorer">
    <div className="dbt-explorer-toolbar">
      <label className="dbt-explorer-search"><Search size={15}/><input placeholder="Search project files" value={search} onChange={e=>setSearch(e.target.value)}/></label>
      <select aria-label="File type" value={filter} onChange={e=>setFilter(e.target.value)}>
        <option value="all">All source files</option><option value="sql">SQL</option><option value="yaml">YAML</option>
      </select>
      <span>{visible.length} files</span>
    </div>
    <div className="dbt-explorer-tree">
      {visible.length ? <TreeFolder key={search+'-'+filter} node={tree} filterActive={Boolean(search||filter!=='all')} onOpen={onOpen} onCreate={onCreate}/> :
        <p>No matching project files.</p>}
    </div>
  </div>
}
