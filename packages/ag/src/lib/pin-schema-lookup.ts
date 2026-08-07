import {
  AUTOMATIONGHOST_PIN_TYPES_V1,
  type AutomationGhostPinTypeV1
} from './automationghost-pin-types'
import { PIN_SCHEMAS } from './pin-schemas'

const MAX_TYPES = 10

const PIN_TYPE_SET = new Set<string>(AUTOMATIONGHOST_PIN_TYPES_V1)

const PIN_CONFIG_FIXTURES: Partial<Record<AutomationGhostPinTypeV1, Record<string, unknown>>> = {
  markdown: { content: '# Example\n\nSummary body.' },
  table: {
    columns: [
      { id: 'col1', name: 'Name', type: 'text' },
      { id: 'col2', name: 'Value', type: 'number' }
    ],
    rows: [{ id: 'row1', cells: { col1: 'Item', col2: 1 } }],
    title: 'Example table'
  },
  'stat-cards': {
    cards: [{ title: 'Count', value: 3, change: '+1', trend: 'up' }]
  },
  list: { items: [{ id: 'li-1', text: 'First item' }] },
  checklist: {
    mode: 'flat',
    items: [{ id: 'item-1', name: 'Task', checked: false }]
  },
  'key-value': {
    items: [{ id: 'kv1', key: 'Status', value: 'ok' }]
  },
  'json-list': {
    items: [{ id: 'j1', label: 'Entry', data: { n: 1 } }]
  },
  'json-viewer': { data: { hello: 'world' } },
  plan: {
    steps: [{ id: 's1', title: 'Step one', status: 'todo' }]
  },
  mermaid: { code: 'flowchart LR\n  A-->B' },
  charts: {
    chartType: 'bar',
    data: [{ label: 'A', value: 1 }]
  }
}

function hintForPinType(pinType: string): string {
  switch (pinType) {
    case 'markdown':
      return 'pin_config.content is the full markdown body.'
    case 'table':
      return 'columns[].id must match keys in rows[].cells; keep rows ≤ 100.'
    case 'stat-cards':
      return 'cards[] needs title + value; trend is up|down|neutral.'
    case 'checklist':
      return 'Use mode "flat" or "sections".'
    default:
      return 'Build pin_config from jsonSchema required fields only.'
  }
}

export type LoadedPinSchema = {
  pin_type: string
  jsonSchema: Record<string, unknown> | null
  example: Record<string, unknown> | null
  hints: string
}

/** Parse pin type ids from specs like `pin.markdown+table` or `step.emit_pins.markdown+stat-cards`. */
export function parsePinTypesFromSpec(spec: string): string[] {
  const s = String(spec ?? '').trim().toLowerCase()
  if (!s) return []

  let payload = ''
  if (s === 'pin' || s.startsWith('pin.')) {
    payload = s === 'pin' ? '' : s.slice('pin.'.length)
  } else if (s.includes('emit_pins')) {
    const idx = s.indexOf('emit_pins')
    const after = s.slice(idx + 'emit_pins'.length).replace(/^[.:]+/, '')
    payload = after
  } else {
    return []
  }

  if (!payload) return []

  const parts = payload
    .split(/[+|,/\s]+/)
    .map((p) => p.trim())
    .filter(Boolean)

  const out: string[] = []
  for (const part of parts) {
    if (PIN_TYPE_SET.has(part) && !out.includes(part)) out.push(part)
  }
  return out.slice(0, MAX_TYPES)
}

/** Also pick known pin type ids mentioned in free-text plan lines. */
export function parsePinTypesFromText(text: string): string[] {
  const lower = String(text ?? '').toLowerCase()
  if (!lower.trim()) return []
  const out: string[] = []
  for (const pinType of AUTOMATIONGHOST_PIN_TYPES_V1) {
    if (lower.includes(pinType) && !out.includes(pinType)) out.push(pinType)
  }
  return out.slice(0, MAX_TYPES)
}

export function resolvePinTypesForPhase(input: {
  spec?: string
  plan?: string
}): string[] {
  const fromSpec = parsePinTypesFromSpec(input.spec ?? '')
  if (fromSpec.length > 0) return fromSpec
  return parsePinTypesFromText(input.plan ?? '')
}

export function looksLikePinEmitStep(input: { spec?: string; plan?: string }): boolean {
  const spec = String(input.spec ?? '').toLowerCase()
  const plan = String(input.plan ?? '').toLowerCase()
  if (spec.includes('emit_pins') || spec.includes('create_pins')) return true
  if (/\bpin[_ ]?config\b|\bpin artifacts?\b|\bpinType\b/.test(plan)) return true
  if (resolvePinTypesForPhase(input).length > 0 && /emit|return|build|create|shape/.test(plan)) {
    return true
  }
  return false
}

export function loadPinSchemas(pinTypes: string[]): LoadedPinSchema[] {
  const unique: string[] = []
  for (const raw of pinTypes) {
    const pinType = String(raw ?? '').trim()
    if (!pinType || unique.includes(pinType)) continue
    unique.push(pinType)
    if (unique.length >= MAX_TYPES) break
  }

  return unique.map((pinType) => {
    const schema = PIN_SCHEMAS[pinType]
    const fixture = PIN_CONFIG_FIXTURES[pinType as AutomationGhostPinTypeV1]
    return {
      pin_type: pinType,
      jsonSchema: schema ?? null,
      example: fixture ?? null,
      hints: hintForPinType(pinType)
    }
  })
}

/** Prompt block for codegen when a code node must return pin artifacts. */
export function formatPinSchemasForCodegen(pinTypes: string[]): string {
  const schemas = loadPinSchemas(pinTypes)
  if (schemas.length === 0) return ''

  const lines = [
    '## Pin artifacts (required return shape)',
    'This step must return a JSON array of pin artifacts for the Cards output node:',
    '[{ "pinType": "<type>", "title"?: string, "pin_config": { ... } }, ...]',
    'Do NOT invent pin_config fields — follow the schemas below exactly.',
    ''
  ]

  for (const entry of schemas) {
    lines.push(`### ${entry.pin_type}`)
    lines.push(`Hints: ${entry.hints}`)
    if (entry.example) {
      lines.push(`Example pin_config: ${JSON.stringify(entry.example)}`)
    }
    if (entry.jsonSchema) {
      lines.push(`jsonSchema: ${JSON.stringify(entry.jsonSchema)}`)
    } else {
      lines.push('jsonSchema: (unknown pin type — skip or use markdown)')
    }
    lines.push('')
  }

  return lines.join('\n').trim()
}

export const AG_PIN_TYPE_NAMES = AUTOMATIONGHOST_PIN_TYPES_V1.join(', ')
