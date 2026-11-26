/** Right-click context action by target. Left clicks are reserved for drag/pan. */
export function canvasContextAction(kind, contract = null) {
  if (kind === 'pan') return 'create-standalone-menu'
  if (kind === 'node' && contract) return 'contract-menu'
  return 'none'
}

/** Keep context menus within the visible viewport, even near canvas edges. */
export function positionCanvasMenu(clientX, clientY, bounds, width = 220, height = 124) {
  return {
    x: Math.max(8, Math.min(clientX - bounds.left, bounds.width - width - 8)),
    y: Math.max(8, Math.min(clientY - bounds.top, bounds.height - height - 8)),
  }
}
