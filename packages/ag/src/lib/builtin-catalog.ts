export type CatalogAuthStatus = 'ready' | 'missing' | 'unavailable'

export type CapabilityEntry = {
  id: string
  label: string
  category: 'trigger' | 'sink' | 'tool' | 'connector'
  authStatus: CatalogAuthStatus
  description?: string
}

export const BUILTIN_CAPABILITY_CATALOG: CapabilityEntry[] = [
  { id: 'trigger.manual', label: 'Manual run', category: 'trigger', authStatus: 'ready' },
  { id: 'trigger.hotkey', label: 'Hotkey', category: 'trigger', authStatus: 'ready' },
  { id: 'trigger.schedule', label: 'Schedule', category: 'trigger', authStatus: 'ready' },
  { id: 'sink.clipboard', label: 'Clipboard', category: 'sink', authStatus: 'ready' },
  { id: 'sink.notification', label: 'Notification', category: 'sink', authStatus: 'ready' },
  { id: 'sink.log', label: 'Log', category: 'sink', authStatus: 'ready' },
  {
    id: 'sink.cards',
    label: 'Cards',
    category: 'sink',
    authStatus: 'ready',
    description: 'Publish pin artifacts to the Cards / gallery run output'
  },
  {
    id: 'pin',
    label: 'Pin shaper',
    category: 'tool',
    authStatus: 'ready',
    description: 'AI pin node — shapes upstream JSON into pin cards at runtime'
  },
  {
    id: 'data.pin',
    label: 'Read pin',
    category: 'tool',
    authStatus: 'ready',
    description: 'Load a gallery/history pin by id, filter rows, project columns/URLs into items[]'
  },
  {
    id: 'control.map',
    label: 'Map / foreach',
    category: 'tool',
    authStatus: 'ready',
    description: 'Foreach: runs the next Profile / Agent / Code node once per item; maxItems caps how many'
  },
  {
    id: 'profile.site',
    label: 'Profile site',
    category: 'tool',
    authStatus: 'ready',
    description: 'Brain research lenses for one URL (wire after control.map for foreach)'
  },
  { id: 'action.copy_and_notify', label: 'Copy + notify', category: 'sink', authStatus: 'ready' },
  { id: 'tool.weather', label: 'Weather', category: 'tool', authStatus: 'ready' },
  { id: 'oauth.google', label: 'Google', category: 'connector', authStatus: 'missing' },
  { id: 'oauth.slack', label: 'Slack', category: 'connector', authStatus: 'missing' },
  { id: 'gmail.read', label: 'Gmail read', category: 'connector', authStatus: 'missing' },
  { id: 'sheets.append', label: 'Google Sheets', category: 'connector', authStatus: 'missing' }
]

export type CapabilityCatalog = {
  entries: CapabilityEntry[]
  byId: Map<string, CapabilityEntry>
}

export function createCapabilityCatalog(
  entries: CapabilityEntry[] = BUILTIN_CAPABILITY_CATALOG
): CapabilityCatalog {
  return {
    entries,
    byId: new Map(entries.map((entry) => [entry.id, entry]))
  }
}

export const DEFAULT_CAPABILITY_CATALOG = createCapabilityCatalog()
