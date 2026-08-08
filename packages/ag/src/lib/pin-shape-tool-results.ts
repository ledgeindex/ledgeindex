import type { PinShapeArtifact } from './pin-shape-types'
import type { CrudPinToolResult } from '../mastra/tools/crud-pin-tools'

function isFailedToolResult(value: unknown): value is CrudPinToolResult {
  return Boolean(value && typeof value === 'object' && 'ok' in value && (value as CrudPinToolResult).ok === false)
}

export function extractToolResultBodies(result: {
  toolResults?: unknown[]
  steps?: Array<{ toolResults?: unknown[] }>
}): unknown[] {
  const bodies: unknown[] = []

  const pushEntry = (entry: unknown): void => {
    if (!entry || typeof entry !== 'object') return
    const record = entry as Record<string, unknown>
    if (record.payload && typeof record.payload === 'object') {
      const payload = record.payload as Record<string, unknown>
      if ('result' in payload) bodies.push(payload.result)
      else if ('output' in payload) bodies.push(payload.output)
      else bodies.push(payload)
      return
    }
    if ('result' in record) bodies.push(record.result)
    else bodies.push(entry)
  }

  for (const entry of result.toolResults ?? []) pushEntry(entry)
  for (const step of result.steps ?? []) {
    for (const entry of step.toolResults ?? []) pushEntry(entry)
  }

  return bodies
}

function isMastraToolValidationError(value: unknown): value is {
  error: true
  message: string
  validationErrors?: unknown
} {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (value as { error?: unknown }).error === true &&
      typeof (value as { message?: unknown }).message === 'string'
  )
}

function flattenValidationErrors(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object') return []
  const record = value as {
    errors?: string[]
    fields?: Record<string, unknown>
  }
  const messages: string[] = []
  if (Array.isArray(record.errors)) {
    for (const err of record.errors) {
      if (typeof err === 'string' && err.trim()) {
        messages.push(prefix ? `${prefix}: ${err}` : err)
      }
    }
  }
  if (record.fields && typeof record.fields === 'object') {
    for (const [key, child] of Object.entries(record.fields)) {
      const nextPrefix = prefix ? `${prefix}.${key}` : key
      messages.push(...flattenValidationErrors(child, nextPrefix))
    }
  }
  return [...new Set(messages)]
}

export function summarizeToolFailures(result: {
  toolResults?: unknown[]
  steps?: Array<{ toolResults?: unknown[] }>
}): string[] {
  const messages: string[] = []

  for (const body of extractToolResultBodies(result)) {
    if (isFailedToolResult(body)) {
      const label = body.pinType ?? body.pinId ?? 'pin'
      const detail = body.errors?.join('; ') ?? body.message ?? 'validation failed'
      messages.push(`${label}: ${detail}`)
      continue
    }

    if (isMastraToolValidationError(body)) {
      const fieldErrors = flattenValidationErrors(body.validationErrors)
      const snippet = body.message.split('\n')[0]?.trim() || 'Tool input validation failed'
      if (fieldErrors.length > 0) {
        messages.push(`${snippet} — ${fieldErrors.slice(0, 4).join('; ')}`)
      } else {
        messages.push(snippet.slice(0, 280))
      }
    }
  }

  return messages
}

export function collectPinsFromToolResults(result: {
  toolResults?: unknown[]
  steps?: Array<{ toolResults?: unknown[] }>
}): PinShapeArtifact[] {
  const pins: PinShapeArtifact[] = []
  const seen = new Set<string>()

  for (const body of extractToolResultBodies(result)) {
    if (!body || typeof body !== 'object') continue
    const record = body as Record<string, unknown>
    if (record.ok !== true) continue
    if (typeof record.pinId !== 'string' || typeof record.pinType !== 'string') continue

    const pinConfig = record.pinConfig ?? record.pin_config
    if (!pinConfig || typeof pinConfig !== 'object' || Array.isArray(pinConfig)) continue
    if (seen.has(record.pinId)) continue
    seen.add(record.pinId)

    pins.push({
      pinId: record.pinId,
      pinType: record.pinType,
      title: typeof record.title === 'string' ? record.title : undefined,
      pin_config: pinConfig as Record<string, unknown>
    })
  }

  return pins
}
