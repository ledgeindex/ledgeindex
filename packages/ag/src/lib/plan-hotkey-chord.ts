/** Default when the plan does not name a shortcut. */
export const DEFAULT_HOTKEY_CHORD = 'Ctrl+Shift+I'

const ALLOWED_MODIFIERS = new Set(['Ctrl', 'Cmd', 'Alt', 'Shift'])

/** Matches Ctrl+Shift+S, Cmd+Shift+K, CommandOrControl+Shift+I, etc. */
const CHORD_IN_TEXT_RE =
  /\b(?:Ctrl|Control|Cmd|Command|Meta|CommandOrControl)(?:\+(?:Shift|Alt|Ctrl|Control|Cmd|Command|Meta|CommandOrControl)){0,3}\+[A-Za-z][A-Za-z0-9]*\b/g

export type HotkeyPhaseLike = {
  spec: string
  plan?: string
  title?: string
  chord?: string
}

export function isHotkeySpec(spec: string): boolean {
  const s = spec.toLowerCase()
  return s.includes('hotkey') || s.includes('modifier')
}

function normalizeModifier(modifier: string): string | null {
  switch (modifier.toLowerCase()) {
    case 'ctrl':
    case 'control':
    case 'commandorcontrol':
      return 'Ctrl'
    case 'cmd':
    case 'meta':
    case 'command':
      return 'Cmd'
    case 'alt':
    case 'altgraph':
      return 'Alt'
    case 'shift':
      return 'Shift'
    default:
      return null
  }
}

function normalizeKey(key: string): string {
  if (key.length === 1) return key.toUpperCase()
  if (/^f\d{1,2}$/i.test(key)) return key.toUpperCase()
  return key
}

export function normalizeHotkeyChord(chord: string): string | null {
  const trimmed = chord.trim()
  if (!trimmed) return null

  const parts = trimmed.split('+').map((part) => part.trim()).filter(Boolean)
  if (parts.length < 2) return null

  const key = normalizeKey(parts[parts.length - 1]!)
  const modifiers = parts.slice(0, -1)
  const normalizedModifiers: string[] = []

  for (const modifier of modifiers) {
    const normalized = normalizeModifier(modifier)
    if (!normalized) return null
    normalizedModifiers.push(normalized)
  }

  const result = [...normalizedModifiers, key].join('+')
  return isValidHotkeyChord(result) ? result : null
}

export function isValidHotkeyChord(chord: string): boolean {
  const parts = chord.split('+').map((part) => part.trim()).filter(Boolean)
  if (parts.length < 2) return false

  const modifiers = parts.slice(0, -1)
  const key = parts[parts.length - 1]!
  if (!key || modifiers.length === 0) return false
  if (!modifiers.every((modifier) => ALLOWED_MODIFIERS.has(modifier))) return false
  if (key.length === 1) return /^[A-Z0-9]$/i.test(key)
  if (/^F\d{1,2}$/i.test(key)) return true
  return /^[A-Z][A-Za-z0-9]*$/.test(key)
}

export function extractHotkeyChordFromText(text: string): string | null {
  const matches = text.match(CHORD_IN_TEXT_RE)
  if (!matches?.length) return null
  for (const match of matches) {
    const normalized = normalizeHotkeyChord(match)
    if (normalized) return normalized
  }
  return null
}

/** Resolve chord for a hotkey phase: explicit field → plan text → default. */
export function resolveHotkeyChordForPhase(phase: HotkeyPhaseLike): string {
  if (phase.chord?.trim()) {
    const normalized = normalizeHotkeyChord(phase.chord)
    if (normalized) return normalized
  }

  for (const text of [phase.plan, phase.title, phase.spec]) {
    if (!text) continue
    const extracted = extractHotkeyChordFromText(text)
    if (extracted) return extracted
  }

  return DEFAULT_HOTKEY_CHORD
}
