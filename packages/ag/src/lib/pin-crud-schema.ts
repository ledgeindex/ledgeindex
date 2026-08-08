/**
 * Pin tool schema + validation — same approach as agents-content pindown-chat-tools:
 * PIN_SCHEMAS → jsonSchemaToZod (lenient tool input) → normalize + validatePinConfigStrict in execute().
 *
 * PIN_SCHEMAS and helpers are vendored under src/lib/pin-schemas (no cross-package imports).
 */
import { z } from 'zod'
import { PIN_SCHEMAS } from './pin-schemas/index.js'
import { normalizeKeyValuePinConfig } from './key-value-pin-normalize.js'
import { MARKDOWN_PIN_MAX_CHARS } from './markdown-pin-limits.js'

type JsonSchema = {
  type?: string | string[]
  description?: string
  enum?: Array<string | number | boolean>
  const?: unknown
  minItems?: number
  maxItems?: number
  required?: string[]
  properties?: Record<string, JsonSchema>
  additionalProperties?: boolean | JsonSchema
  items?: JsonSchema
  anyOf?: JsonSchema[]
  oneOf?: JsonSchema[]
}

function schemaNode(node: JsonSchema | undefined): JsonSchema | undefined {
  if (!node) return undefined
  if (Array.isArray(node.oneOf) && node.oneOf.length > 0) return node.oneOf[0]
  if (Array.isArray(node.anyOf) && node.anyOf.length > 0) return node.anyOf[0]
  return node
}

function schemaType(node: JsonSchema | undefined): string | undefined {
  const types = schemaTypes(node)
  return types[0]
}

function schemaTypes(node: JsonSchema | undefined): string[] {
  const resolved = schemaNode(node)
  if (!resolved?.type) return []
  if (Array.isArray(resolved.type)) {
    return resolved.type.filter((t) => t && t !== 'null')
  }
  return resolved.type ? [resolved.type] : []
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeMultilineString(value: unknown): string {
  return String(value ?? '')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .trim()
}

function geminiCompatibleStringEnum(stringValues: [string, ...string[]]): z.ZodTypeAny {
  return stringValues.length === 1 ? z.literal(stringValues[0]) : z.enum(stringValues)
}

function jsonEnumToZod(values: Array<string | number | boolean>): z.ZodTypeAny {
  if (values.length === 0) return z.any()
  if (values.every((v) => typeof v === 'string')) {
    const stringValues = values as [string, ...string[]]
    return geminiCompatibleStringEnum(stringValues)
  }
  if (values.every((v) => typeof v === 'number')) {
    const stringValues = values.map(String) as [string, ...string[]]
    return z
      .preprocess((val) => (typeof val === 'number' ? String(val) : val), geminiCompatibleStringEnum(stringValues))
      .transform((s) => Number(s))
  }
  if (values.every((v) => typeof v === 'boolean')) {
    const stringValues = values.map(String) as [string, ...string[]]
    return z
      .preprocess((val) => (typeof val === 'boolean' ? String(val) : val), geminiCompatibleStringEnum(stringValues))
      .transform((s) => s === 'true')
  }
  const literals = values.map((v) => z.literal(v as never))
  if (literals.length === 1) return literals[0]
  return literals.length === 2
    ? z.union([literals[0], literals[1]])
    : z.union([literals[0], literals[1], ...literals.slice(2)])
}

export function jsonSchemaToZod(raw: JsonSchema | undefined): z.ZodTypeAny {
  const node = schemaNode(raw)
  if (!node) return z.any()
  if (Object.prototype.hasOwnProperty.call(node, 'const')) {
    return z.literal(node.const as never)
  }
  if (Array.isArray(node.enum) && node.enum.length > 0) {
    return jsonEnumToZod(node.enum)
  }

  const type = schemaType(node)
  const types = schemaTypes(node)
  const primitiveSchemas = types
    .map((candidate) => {
      if (candidate === 'string') return z.string()
      if (candidate === 'number') return z.number()
      if (candidate === 'integer') return z.number().int()
      if (candidate === 'boolean') return z.boolean()
      return null
    })
    .filter((candidate): candidate is z.ZodTypeAny => candidate !== null)
  if (primitiveSchemas.length === types.length && primitiveSchemas.length > 1) {
    return z.union([
      primitiveSchemas[0],
      primitiveSchemas[1],
      ...primitiveSchemas.slice(2)
    ])
  }

  if (type === 'object' || (!type && isPlainObject(node.properties))) {
    const properties = node.properties ?? {}
    const requiredSet = new Set(Array.isArray(node.required) ? node.required : [])
    const shape: Record<string, z.ZodTypeAny> = {}
    for (const [key, child] of Object.entries(properties)) {
      const childSchema = jsonSchemaToZod(child)
      shape[key] = requiredSet.has(key) ? childSchema : childSchema.optional()
    }
    const objectSchema = z.object(shape)
    if (isPlainObject(node.additionalProperties)) {
      return objectSchema.catchall(jsonSchemaToZod(node.additionalProperties))
    }
    return objectSchema.passthrough()
  }

  if (type === 'array') {
    const itemSchema = jsonSchemaToZod(node.items)
    let arraySchema = z.array(itemSchema)
    if (typeof node.minItems === 'number') arraySchema = arraySchema.min(node.minItems)
    return arraySchema
  }

  if (type === 'string') return z.string()
  if (type === 'number') return z.number()
  if (type === 'integer') return z.number().int()
  if (type === 'boolean') return z.boolean()
  return z.any()
}

function finalizeByPinType(
  pinType: string,
  config: Record<string, unknown>,
  _fallbackTitle: string
): Record<string, unknown> {
  const out = { ...config }
  if (pinType === 'table') {
    const rawColumns = Array.isArray(out.columns) ? out.columns : []
    const normalizedColumns = rawColumns
      .map((col: unknown) => {
        const c = col as Record<string, unknown>
        const name = String(c?.name ?? c?.title ?? c?.label ?? '').trim()
        const id = String(c?.id ?? '').trim()
        if (!name) return null
        if (!id) return null
        const rawType = String(c?.type ?? 'text').toLowerCase()
        const type: 'text' | 'number' | 'checkbox' =
          rawType === 'number' || rawType === 'checkbox' ? (rawType as 'number' | 'checkbox') : 'text'
        const widthValue =
          typeof c?.width === 'number'
            ? c.width
            : typeof c?.width === 'string'
              ? Number(c.width)
              : undefined
        const hasValidWidth = typeof widthValue === 'number' && Number.isFinite(widthValue)
        return {
          id,
          name,
          type,
          ...(hasValidWidth ? { width: widthValue } : {})
        }
      })
      .filter(Boolean) as Array<{ id: string; name: string; type: 'text' | 'number' | 'checkbox'; width?: number }>
    out.columns = normalizedColumns

    const columnNameToId = new Map<string, string>()
    for (const col of out.columns as Array<{ id: string; name: string }>) {
      columnNameToId.set(String(col.id), String(col.id))
      columnNameToId.set(String(col.name), String(col.id))
    }

    const rawRows = Array.isArray(out.rows) ? out.rows : []
    const normalizedRows = rawRows
      .map((row: unknown) => {
        const r = row as Record<string, unknown>
        const rowId = String(r?.id ?? '').trim()
        if (!rowId) return null
        const cells: Record<string, unknown> = {}
        if (Array.isArray(r?.cells)) {
          for (const entry of r.cells) {
            if (!isPlainObject(entry)) continue
            const key = String(entry.columnId ?? entry.key ?? entry.id ?? '').trim()
            if (!key) continue
            const mappedColumnId = columnNameToId.get(key) ?? key
            cells[mappedColumnId] = entry.value
          }
        } else {
          const rowCells = isPlainObject(r?.cells) ? r.cells : {}
          for (const [key, value] of Object.entries(rowCells)) {
            const mappedColumnId = columnNameToId.get(String(key)) ?? String(key)
            cells[mappedColumnId] = value
          }
        }
        for (const col of out.columns as Array<{ id: string }>) {
          if (!(col.id in cells)) cells[col.id] = null
        }
        return { id: rowId, cells }
      })
      .filter((row): row is { id: string; cells: Record<string, unknown> } =>
        Boolean(row && isPlainObject((row as { cells?: unknown }).cells))
      )
    out.rows = normalizedRows
  }

  if (pinType === 'plan') {
    const normalizeBlock = (block: unknown) => {
      const b = block as Record<string, unknown>
      const type = String(b?.type ?? '').trim()
      if (type === 'details') {
        const items = Array.isArray(b?.items)
          ? b.items.map((item) => String(item ?? '').trim()).filter(Boolean)
          : []
        if (items.length < 1) return null
        return {
          type: 'details',
          ...(b?.title != null ? { title: String(b.title) } : {}),
          items
        }
      }
      if (type === 'command') {
        const command = String(b?.command ?? '').trim()
        if (!command) return null
        return {
          type: 'command',
          command,
          ...(b?.label != null ? { label: String(b.label) } : {})
        }
      }
      if (type === 'code') {
        const code = String(b?.code ?? b?.content ?? '').trim()
        if (!code) return null
        const language = String(b?.language ?? '').trim()
        const filename = String(b?.filename ?? '').trim()
        const title = String(b?.title ?? b?.label ?? '').trim()
        return {
          type: 'code',
          code,
          ...(language ? { language } : {}),
          ...(filename ? { filename } : {}),
          ...(title ? { title } : {})
        }
      }
      if (type === 'text') {
        const content = String(b?.content ?? '').trim()
        if (!content) return null
        return { type: 'text', content }
      }
      if (type === 'link') {
        let url = String(b?.url ?? '').trim()
        if (!url) return null
        if (!/^https?:\/\//i.test(url)) url = `https://${url}`
        const label = String(b?.label ?? '').trim()
        return { type: 'link', url, ...(label ? { label } : {}) }
      }
      if (type === 'mermaid') {
        const diagram = normalizeMultilineString(b?.diagram ?? b?.code ?? '')
        if (!diagram) return null
        const title = String(b?.title ?? '').trim()
        return { type: 'mermaid', diagram, ...(title ? { title } : {}) }
      }
      if (type === 'summary') {
        const content = String(b?.content ?? '').trim()
        if (!content) return null
        const title = String(b?.title ?? '').trim()
        return { type: 'summary', content, ...(title ? { title } : {}) }
      }
      return null
    }

    const rawPhases = Array.isArray(out.phases) ? out.phases : []
    out.phases = rawPhases
      .map((phase: unknown, phaseIdx: number) => {
        const p = phase as Record<string, unknown>
        const title = String(p?.title ?? '').trim()
        if (!title) return null
        const status = ['pending', 'in-progress', 'completed'].includes(String(p?.status))
          ? p.status
          : 'pending'
        const rawTasks = Array.isArray(p?.tasks) ? p.tasks : []
        const tasks = rawTasks
          .map((task: unknown, taskIdx: number) => {
            const t = task as Record<string, unknown>
            const taskTitle = String(t?.title ?? '').trim()
            if (!taskTitle) return null
            const rawBlocks = Array.isArray(t?.blocks) ? t.blocks : []
            const blocks = rawBlocks.map(normalizeBlock).filter(Boolean)
            return {
              id: String(t?.id ?? '').trim() || `task-${phaseIdx + 1}-${taskIdx + 1}`,
              title: taskTitle,
              ...(t?.number != null ? { number: String(t.number) } : {}),
              ...(t?.label != null ? { label: String(t.label) } : {}),
              ...(t?.description != null ? { description: String(t.description) } : {}),
              ...(blocks.length > 0 ? { blocks } : {})
            }
          })
          .filter(Boolean)
        if (tasks.length < 1) return null
        return {
          id: String(p?.id ?? '').trim() || `phase-${phaseIdx + 1}`,
          title,
          status,
          tasks
        }
      })
      .filter(Boolean)
  }

  if (pinType === 'mermaid') {
    const diagram = normalizeMultilineString(out.diagram ?? out.code ?? '')
    if (diagram) out.diagram = diagram
    const title = String(out.title ?? '').trim()
    if (title) out.title = title
    else delete out.title
  }

  if (pinType === 'key-value') {
    return normalizeKeyValuePinConfig(out)
  }

  return out
}

export function normalizePinConfigForCreate(
  pinType: string,
  pinConfig: Record<string, unknown>,
  fallbackTitle: string
): Record<string, unknown> {
  const schema = (PIN_SCHEMAS as Record<string, JsonSchema | undefined>)[pinType]
  if (!schema) return pinConfig ?? {}
  const normalized = isPlainObject(pinConfig) ? pinConfig : {}
  return finalizeByPinType(pinType, normalized, fallbackTitle)
}

function validateSchemaNode(
  rawNode: JsonSchema | undefined,
  value: unknown,
  path: string,
  errors: string[]
): void {
  const node = schemaNode(rawNode)
  if (!node) return
  const type = schemaType(node)

  if (type === 'object') {
    if (!isPlainObject(value)) {
      errors.push(`${path} must be an object`)
      return
    }
    const required = Array.isArray(node.required) ? node.required : []
    for (const key of required) {
      if (!(key in value)) {
        errors.push(`${path}.${key} is required`)
      }
    }
    for (const [key, child] of Object.entries(node.properties ?? {})) {
      if (key in value) {
        validateSchemaNode(child, value[key], `${path}.${key}`, errors)
      }
    }
    if (isPlainObject(node.additionalProperties)) {
      const knownProperties = new Set(Object.keys(node.properties ?? {}))
      for (const [key, childValue] of Object.entries(value)) {
        if (!knownProperties.has(key)) {
          validateSchemaNode(node.additionalProperties, childValue, `${path}.${key}`, errors)
        }
      }
    }
    return
  }

  if (type === 'array') {
    if (!Array.isArray(value)) {
      errors.push(`${path} must be an array`)
      return
    }
    if (typeof node.minItems === 'number' && value.length < node.minItems) {
      errors.push(`${path} must contain at least ${node.minItems} item(s)`)
    }
    if (typeof node.maxItems === 'number' && value.length > node.maxItems) {
      errors.push(`${path} must contain at most ${node.maxItems} item(s)`)
    }
    for (let i = 0; i < value.length; i += 1) {
      validateSchemaNode(node.items, value[i], `${path}[${i}]`, errors)
    }
    return
  }

  const types = schemaTypes(node)
  if (types.length > 1) {
    const matches = types.some((candidate) => {
      if (candidate === 'string') return typeof value === 'string'
      if (candidate === 'number') return typeof value === 'number' && Number.isFinite(value)
      if (candidate === 'integer') return typeof value === 'number' && Number.isInteger(value)
      if (candidate === 'boolean') return typeof value === 'boolean'
      return false
    })
    if (!matches) {
      errors.push(`${path} must be one of: ${types.join(', ')}`)
    }
    return
  }

  if (type === 'string' && typeof value !== 'string') {
    errors.push(`${path} must be a string`)
    return
  }
  if (
    path === 'pin_config.content' &&
    typeof value === 'string' &&
    value.length > MARKDOWN_PIN_MAX_CHARS
  ) {
    errors.push(
      `pin_config.content exceeds ${MARKDOWN_PIN_MAX_CHARS.toLocaleString()} characters (${value.length.toLocaleString()}). Split into multiple markdown pins or shorten the source.`
    )
    return
  }
  if (type === 'number' && typeof value !== 'number') {
    errors.push(`${path} must be a number`)
    return
  }
  if (type === 'integer' && (!Number.isInteger(value as number) || typeof value !== 'number')) {
    errors.push(`${path} must be an integer`)
    return
  }
  if (type === 'boolean' && typeof value !== 'boolean') {
    errors.push(`${path} must be a boolean`)
    return
  }
  if (Array.isArray(node.enum) && node.enum.length > 0 && !node.enum.includes(value as never)) {
    errors.push(`${path} must be one of: ${node.enum.join(', ')}`)
  }
}

export function validatePinConfigStrict(pinType: string, pinConfig: Record<string, unknown>): string[] {
  const schema = (PIN_SCHEMAS as Record<string, JsonSchema | undefined>)[pinType]
  if (!schema) return []
  const errors: string[] = []
  validateSchemaNode(schema, pinConfig, 'pin_config', errors)

  if (pinType === 'table') {
    const columns = Array.isArray(pinConfig.columns) ? pinConfig.columns : []
    const rows = Array.isArray(pinConfig.rows) ? pinConfig.rows : []
    if (columns.length < 1) errors.push('pin_config.columns must contain at least 1 item')
    if (rows.length < 1) errors.push('pin_config.rows must contain at least 1 item')
    if (rows.length > 100) errors.push('pin_config.rows must contain at most 100 items')
  }

  if (pinType === 'plan') {
    const phases = Array.isArray(pinConfig.phases) ? pinConfig.phases : []
    if (phases.length < 1) errors.push('pin_config.phases must contain at least 1 item')
    phases.forEach((phase: unknown, phaseIdx: number) => {
      const tasks = Array.isArray((phase as Record<string, unknown>)?.tasks)
        ? (phase as Record<string, unknown>).tasks
        : []
      if (!Array.isArray(tasks) || tasks.length < 1) {
        errors.push(`pin_config.phases[${phaseIdx}].tasks must contain at least 1 item`)
      }
    })
  }

  if (pinType === 'key-value') {
    const items = Array.isArray(pinConfig.items) ? pinConfig.items : []
    if (items.length < 1) {
      errors.push(
        'pin_config.items must contain at least 1 metric — use items[{id,key,value}], never content.data'
      )
    }
    if (items.length > 48) {
      errors.push('pin_config.items must contain at most 48 metrics')
    }
    items.forEach((item: unknown, idx: number) => {
      const row = item as Record<string, unknown>
      const key = String(row?.key ?? '').trim()
      if (!key) errors.push(`pin_config.items[${idx}].key is required`)
      if (row?.value == null || row?.value === '') {
        errors.push(`pin_config.items[${idx}].value is required`)
      }
    })
  }

  return errors
}

function pinConfigDescription(pinType: string): string {
  const pinSchema = (PIN_SCHEMAS as Record<string, JsonSchema | undefined>)[pinType]
  if (typeof pinSchema?.description === 'string' && pinSchema.description.trim()) {
    return pinSchema.description.trim()
  }
  return `Valid ${pinType} pin_config from PIN_SCHEMAS.`
}

const tableToolCellValueSchema = z.union([z.string(), z.number(), z.boolean()])

const tableToolPinConfigSchema = z.object({
  columns: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        type: z.enum(['text', 'number', 'checkbox']).optional(),
        width: z.number().optional()
      })
    )
    .min(1),
  rows: z
    .array(
      z.object({
        id: z.string(),
        cells: z
          .array(
            z.object({
              columnId: z.string().describe('Exact id of a declared column'),
              value: tableToolCellValueSchema.describe(
                'Populated cell value from the upstream data; never null'
              )
            })
          )
          .min(1)
          .describe('One populated entry for every declared column')
      })
    )
    .min(1)
    .max(100),
  title: z.string().optional()
})

function strictPinConfigZod(pinType: string) {
  // Gemini cannot reliably populate dynamic record values from Zod 4 tool schemas.
  // The table tool therefore accepts explicit cell entries and normalization converts
  // them back to the canonical PIN_SCHEMAS table record before strict validation.
  if (pinType === 'table') return tableToolPinConfigSchema
  const pinSchema = (PIN_SCHEMAS as Record<string, JsonSchema | undefined>)[pinType]
  return pinSchema ? jsonSchemaToZod(pinSchema) : z.record(z.any())
}

/** Pin-shaper create_*_pin — no mode or pinId; create-only. */
export function buildCreateInputSchema(pinType: string) {
  const strictPinConfigSchema = strictPinConfigZod(pinType)
  const desc = pinConfigDescription(pinType)

  return z.object({
    pin_config: strictPinConfigSchema
      .optional()
      .describe(`${desc} Required on create.`),
    title: z.string().optional().describe('Pin display title (metadata), not pin_config.title.')
  })
}

/** Pin-shaper update_*_pin — pinId required; update-only. */
export function buildUpdateInputSchema(pinType: string) {
  const strictPinConfigSchema = strictPinConfigZod(pinType)
  const desc = pinConfigDescription(pinType)

  return z.object({
    pinId: z
      .string()
      .describe('Existing pin id from update targets — must match a listed target.'),
    pin_config: strictPinConfigSchema
      .optional()
      .describe(`${desc} Partial fields merge onto existing pin_config.`),
    title: z.string().optional().describe('Pin display title (metadata), not pin_config.title.')
  })
}

/**
 * Same input schema as agents-content buildCrudInputSchema(pinType).
 * Flat top-level object — Gemini rejects z.union/anyOf on the tool root schema.
 */
export function buildCrudInputSchema(pinType: string) {
  const strictPinConfigSchema = strictPinConfigZod(pinType)
  const desc = pinConfigDescription(pinType)

  return z.object({
    mode: z
      .enum(['create', 'read', 'update', 'delete'])
      .optional()
      .describe('Defaults to create. read/update/delete require pinId.'),
    pinId: z.string().optional().describe('Required for read, update, and delete.'),
    pin_config: strictPinConfigSchema
      .optional()
      .describe(`${desc} Required on create; partial fields merge on update.`),
    userId: z.string().optional(),
    title: z.string().optional().describe('Pin display title (metadata), not pin_config.title.')
  })
}
