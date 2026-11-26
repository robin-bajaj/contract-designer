import React, { useState } from 'react'
import { ChevronDown, ChevronRight, Layers, Link2, Plus, X, Eye, GitBranch } from 'lucide-react'
import { buildContractTree } from './contractTree'

/** Inheritance tree for the sidebar; nested depth comes from uses, not name prefixes. */
export default function ContractExplorer({ contracts, search, activeId, onOpen, onRemove, onAddChild }) {
  const { roots, matchingCount } = buildContractTree(contracts, search)
  const [collapsed, setCollapsed] = useState({})
  const [menuId, setMenuId] = useState(null)
  const searching = Boolean(search.trim())
  const renderNode = (node, depth = 0) => {
    const { contract, children } = node
    const hasChildren = children.length > 0
    const expanded = searching || !collapsed[contract.id]
    return <React.Fragment key={contract.id}>
      <div className={`nav-item tree-item ${activeId === contract.id ? 'selected' : ''}`} style={{ '--tree-depth': depth }}>
        <button type="button" className="tree-chevron" aria-label={`${expanded ? 'Collapse' : 'Expand'} ${contract.name}`} aria-expanded={expanded} disabled={!hasChildren} onClick={() => setCollapsed(current => ({...current, [contract.id]: !current[contract.id]}))}>
          {hasChildren ? expanded ? <ChevronDown size={15}/> : <ChevronRight size={15}/> : <span className="tree-dot"/>}
        </button>
        <button type="button" className="nav-link" title={`${contract.name} v${contract.version}`} onClick={() => contract.uses ? (setMenuId(null), onOpen(contract.id)) : setMenuId(current => current === contract.id ? null : contract.id)}>
          {contract.uses ? <Link2 size={15}/> : <Layers size={15}/>}
          <span>{contract.name}</span>
          <small>v{contract.version}</small>
        </button>
        <button type="button" className="icon-quiet danger tree-remove" title={`Delete ${contract.name}`} aria-label={`Delete ${contract.name}`} onClick={() => onRemove(contract.id)}><X size={14}/></button>
      </div>
      {menuId === contract.id && !contract.uses && <div className="tree-context-actions" style={{ '--tree-depth': depth }}><button type="button" onClick={() => {setMenuId(null);onOpen(contract.id)}}><Eye size={13}/> View Contract</button><button type="button" onClick={() => {setMenuId(null);onAddChild(contract)}}><GitBranch size={13}/> Create Child</button></div>}
      {hasChildren && expanded && <div className="tree-descendants">{children.map(child => renderNode(child, depth + 1))}</div>}
    </React.Fragment>
  }
  return <nav className="contract-nav" aria-label="Contract inheritance tree">
    {roots.length ? roots.map(root => renderNode(root)) : <p className="muted empty-tree">No matching contracts.</p>}
    {searching && <p className="tree-search-summary">{matchingCount} matching contract{matchingCount === 1 ? '' : 's'} · parent folders shown for context</p>}
  </nav>
}
