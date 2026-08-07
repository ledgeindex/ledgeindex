/** User-authored custom knowledge items attached to a flow package (`custom-info.json`). */

export type FlowCustomInfoItem = {
  id: string
  title: string
  body: string
  createdAt: string
  updatedAt: string
}

export type FlowCustomInfoFile = {
  version: 1
  items: FlowCustomInfoItem[]
}

export const FLOW_CUSTOM_INFO_FILENAME = 'custom-info.json'

export function emptyFlowCustomInfo(): FlowCustomInfoFile {
  return { version: 1, items: [] }
}

export function parseFlowCustomInfo(raw: unknown): FlowCustomInfoFile {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return emptyFlowCustomInfo()
  }
  const record = raw as Record<string, unknown>
  const itemsRaw = Array.isArray(record.items) ? record.items : []
  const items: FlowCustomInfoItem[] = []
  for (const entry of itemsRaw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const row = entry as Record<string, unknown>
    const id = typeof row.id === 'string' ? row.id.trim() : ''
    const title = typeof row.title === 'string' ? row.title.trim() : ''
    const body = typeof row.body === 'string' ? row.body : ''
    if (!id || !title) continue
    const createdAt =
      typeof row.createdAt === 'string' && row.createdAt.trim()
        ? row.createdAt
        : new Date().toISOString()
    const updatedAt =
      typeof row.updatedAt === 'string' && row.updatedAt.trim()
        ? row.updatedAt
        : createdAt
    items.push({ id, title, body, createdAt, updatedAt })
  }
  return { version: 1, items }
}

export function customInfoTitles(file: FlowCustomInfoFile): string[] {
  return file.items.map((item) => item.title)
}
