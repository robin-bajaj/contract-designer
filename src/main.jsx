import React from 'react'
import { createRoot } from 'react-dom/client'
import RoleGateway from './features/auth/RoleGateway.jsx'

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root mount element')
createRoot(root).render(<RoleGateway />)
