export type InferredOutputShape = {
  keys: string[]
  /** Short snippets of return object literals found in source */
  returnLiterals: string[]
}

const RETURN_OBJECT_RE = /return\s*\{([^}]*)\}/gs

function parseReturnObjectBody(body: string): string[] {
  const keys = new Set<string>()
  for (const part of body.split(',')) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const shorthand = trimmed.match(/^([A-Za-z_$][\w$]*)\s*(?::|$)/)
    if (shorthand?.[1]) {
      keys.add(shorthand[1])
      continue
    }
    const quoted = trimmed.match(/^['"]([^'"]+)['"]\s*:/)
    if (quoted?.[1]) keys.add(quoted[1])
  }
  return [...keys]
}

/** Best-effort static inference of top-level keys returned from a code.ts node. */
export function inferReturnShapeFromSource(source: string): InferredOutputShape {
  const keys = new Set<string>()
  const returnLiterals: string[] = []

  for (const match of source.matchAll(RETURN_OBJECT_RE)) {
    const body = match[1] ?? ''
    returnLiterals.push(`{${body.trim().slice(0, 120)}}`)
    for (const key of parseReturnObjectBody(body)) {
      keys.add(key)
    }
  }

  return {
    keys: [...keys],
    returnLiterals: returnLiterals.slice(0, 3)
  }
}

export function pickFieldForShape(
  keys: string[],
  preferred: string[] = ['text', 'kind', 'value', 'message', 'data']
): string {
  for (const candidate of preferred) {
    if (keys.includes(candidate)) return candidate
  }
  return keys[0] ?? 'text'
}
