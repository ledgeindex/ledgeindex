/**
 * Parse declared phase.outputShape strings and assert runtime outputs contain expected keys.
 * (Mirrored in automationghost-electron for desktop verify; keep logic in sync.)
 */

export function extractExpectedKeys(outputShape: string): string[] {
  const trimmed = outputShape.trim()
  if (!trimmed) return []

  const brace = trimmed.match(/\{([^}]*)\}/)
  const body = brace?.[1] ?? trimmed
  const keys = new Set<string>()

  for (const part of body.split(/[,;\n]/)) {
    const token = part.trim()
    if (!token) continue
    const named = token.match(/^([A-Za-z_$][\w$]*)\s*(?::|$)/)
    if (named?.[1]) keys.add(named[1])
  }

  return [...keys]
}

export function extractEnvelopeKey(outputShape: string): string | null {
  const trimmed = outputShape.trim()
  if (trimmed.startsWith('{')) return null
  const match = trimmed.match(/^([A-Za-z_$][\w$]*)\s*:/)
  return match?.[1] ?? null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function collectKeysFromValue(value: unknown, depth = 0): Set<string> {
  const keys = new Set<string>()
  if (depth > 3) return keys

  if (Array.isArray(value)) {
    for (const item of value.slice(0, 3)) {
      for (const k of collectKeysFromValue(item, depth + 1)) keys.add(k)
    }
    return keys
  }

  const record = asRecord(value)
  if (!record) return keys
  for (const [k, v] of Object.entries(record)) {
    keys.add(k)
    if (v && typeof v === 'object') {
      for (const nested of collectKeysFromValue(v, depth + 1)) keys.add(nested)
    }
  }
  return keys
}

export type ShapeAssertResult =
  | { ok: true }
  | { ok: false; missingKeys: string[]; message: string; observedKeys: string[] }

export function assertStepOutputShape(
  output: unknown,
  outputShape: string | undefined
): ShapeAssertResult {
  if (!outputShape?.trim()) return { ok: true }

  const expected = extractExpectedKeys(outputShape)
  const envelope = extractEnvelopeKey(outputShape)
  const observedKeys = [...collectKeysFromValue(output)]

  if (expected.length === 0 && !envelope) return { ok: true }

  let searchRoot: unknown = output
  if (envelope) {
    const record = asRecord(output)
    if (!record || !(envelope in record)) {
      return {
        ok: false,
        missingKeys: [envelope],
        observedKeys,
        message: `Expected envelope key "${envelope}" from outputShape "${outputShape}"`
      }
    }
    searchRoot = record[envelope]
  }

  // Empty arrays are valid for Item[] shapes — item keys only apply when items exist.
  if (Array.isArray(searchRoot) && searchRoot.length === 0) {
    return { ok: true }
  }

  const rootKeys = collectKeysFromValue(searchRoot)
  const missing = expected.filter((k) => !rootKeys.has(k))
  if (missing.length === 0) return { ok: true }

  return {
    ok: false,
    missingKeys: missing,
    observedKeys: [...rootKeys],
    message: `Missing keys [${missing.join(', ')}] for outputShape "${outputShape}" (observed: ${[...rootKeys].join(', ') || 'none'})`
  }
}
