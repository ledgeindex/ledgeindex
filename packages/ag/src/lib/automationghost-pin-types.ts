/** Pin types supported in AutomationGhost v1 — keep in sync with automationghost-electron PIN_TYPE_IDS_V1. */
export const AUTOMATIONGHOST_PIN_TYPES_V1 = [
  'markdown',
  'table',
  'plan',
  'list',
  'json-list',
  'checklist',
  'stat-cards',
  'key-value',
  'charts',
  'mermaid',
  'json-viewer',
  'links'
] as const

export type AutomationGhostPinTypeV1 = (typeof AUTOMATIONGHOST_PIN_TYPES_V1)[number]

/** agents-content chat uses unified crud_*_pin tools with a mode field. */
export function crudPinToolId(pinType: string): string {
  return `crud_${pinType}_pin`
}

/** Pin-shaper create flows — only these tools are exposed in create mode. */
export function createPinToolId(pinType: string): string {
  return `create_${pinType}_pin`
}

/** Pin-shaper update flows — only these tools are exposed in update mode. */
export function updatePinToolId(pinType: string): string {
  return `update_${pinType}_pin`
}

export function parseCrudPinToolId(toolId: string): { pinType: string } | null {
  const match = /^crud_(.+)_pin$/.exec(toolId)
  if (!match) return null
  return { pinType: match[1] }
}

export function parsePinShapeToolId(
  toolId: string
): { mode: 'create' | 'update'; pinType: string } | null {
  const createMatch = /^create_(.+)_pin$/.exec(toolId)
  if (createMatch) return { mode: 'create', pinType: createMatch[1] }
  const updateMatch = /^update_(.+)_pin$/.exec(toolId)
  if (updateMatch) return { mode: 'update', pinType: updateMatch[1] }
  return null
}
