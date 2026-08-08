import { z } from 'zod'

export const CONTROL_NODE_TYPES = ['control.if', 'control.switch'] as const
export type ControlNodeType = (typeof CONTROL_NODE_TYPES)[number]

export const controlIfOperatorSchema = z.enum([
  'truthy',
  'falsy',
  'contains',
  'equals',
  'gt',
  'gte',
  'lt',
  'lte'
])

export const CONTROL_IF_DESCRIPTION_MAX = 100

export const controlIfDataSchema = z.object({
  label: z.string().optional(),
  field: z.string().default(''),
  operator: controlIfOperatorSchema.default('truthy'),
  compareValue: z.string().optional(),
  thenDescription: z.string().max(CONTROL_IF_DESCRIPTION_MAX).optional(),
  elseDescription: z.string().max(CONTROL_IF_DESCRIPTION_MAX).optional(),
  /** Set at build time after upstream codegen — node id that supplies $input */
  configuredFromUpstream: z.string().optional(),
  /** Keys inferred from upstream return at build time */
  inferredOutputKeys: z.array(z.string()).optional(),
  /** True on plan→flow placeholder until build configures the IF */
  configPending: z.boolean().optional()
})

export const controlSwitchCaseSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  value: z.string()
})

export const controlSwitchDataSchema = z.object({
  label: z.string().optional(),
  field: z.string().min(1).default('kind'),
  cases: z.array(controlSwitchCaseSchema).default([]),
  defaultCaseId: z.string().optional()
})

export type ControlIfData = z.infer<typeof controlIfDataSchema>
export type ControlSwitchData = z.infer<typeof controlSwitchDataSchema>

export function isControlNodeType(type: string): type is ControlNodeType {
  return (CONTROL_NODE_TYPES as readonly string[]).includes(type)
}

export function getValueAtPath(input: unknown, path: string): unknown {
  const trimmed = path.trim()
  if (!trimmed) return input

  const parts = trimmed.split('.').filter(Boolean)
  let current: unknown = input
  for (const part of parts) {
    if (current === null || current === undefined) return undefined
    if (typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

function compareScalar(left: unknown, operator: ControlIfData['operator'], compareValue?: string): boolean {
  if (operator === 'truthy') return Boolean(left)
  if (operator === 'falsy') return !left

  const right = compareValue ?? ''
  const leftText = left === null || left === undefined ? '' : String(left)

  if (operator === 'contains') {
    return leftText.toLowerCase().includes(right.toLowerCase())
  }
  if (operator === 'equals') {
    return leftText === right
  }

  const leftNum = typeof left === 'number' ? left : Number(leftText)
  const rightNum = Number(right)
  if (!Number.isFinite(leftNum) || !Number.isFinite(rightNum)) return false

  if (operator === 'gt') return leftNum > rightNum
  if (operator === 'gte') return leftNum >= rightNum
  if (operator === 'lt') return leftNum < rightNum
  if (operator === 'lte') return leftNum <= rightNum
  return false
}

export function evaluateControlIf(input: unknown, rawData: Record<string, unknown>): 'true' | 'false' {
  const data = controlIfDataSchema.parse(rawData)
  const value = getValueAtPath(input, data.field)
  const result = compareScalar(value, data.operator, data.compareValue)
  return result ? 'true' : 'false'
}

export function evaluateControlSwitch(input: unknown, rawData: Record<string, unknown>): string {
  const data = controlSwitchDataSchema.parse(rawData)
  const value = getValueAtPath(input, data.field)
  const needle = value === null || value === undefined ? '' : String(value)

  for (const item of data.cases) {
    if (item.value === needle) return item.id
  }

  if (data.defaultCaseId) return data.defaultCaseId
  if (data.cases.length > 0) return data.cases[data.cases.length - 1]!.id
  return 'default'
}

export function truncateControlIfDescription(
  text: string | undefined,
  max = CONTROL_IF_DESCRIPTION_MAX
): string | undefined {
  const trimmed = text?.trim()
  if (!trimmed) return undefined
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max - 1)}…`
}

export function formatControlIfCondition(data: Pick<ControlIfData, 'field' | 'operator' | 'compareValue'>): string {
  const field = data.field?.trim() || 'input'
  switch (data.operator) {
    case 'truthy':
      return `${field} is truthy`
    case 'falsy':
      return `${field} is empty`
    case 'contains':
      return `${field} contains “${data.compareValue ?? ''}”`
    case 'equals':
      return `${field} equals “${data.compareValue ?? ''}”`
    case 'gt':
      return `${field} > ${data.compareValue ?? '0'}`
    case 'gte':
      return `${field} ≥ ${data.compareValue ?? '0'}`
    case 'lt':
      return `${field} < ${data.compareValue ?? '0'}`
    case 'lte':
      return `${field} ≤ ${data.compareValue ?? '0'}`
    default:
      return field
  }
}

export function controlIfDataFromPlanPhase(
  phase: { plan: string; title: string; branches?: Array<{ id: string; title: string; plan: string }> },
  label: string
): ControlIfData {
  const trueBranch = phase.branches?.find((branch) => branch.id === 'true')
  const falseBranch = phase.branches?.find((branch) => branch.id === 'false')

  return controlIfDataSchema.parse({
    label,
    field: '',
    operator: 'truthy',
    configPending: true,
    thenDescription: truncateControlIfDescription(trueBranch?.plan || trueBranch?.title),
    elseDescription: truncateControlIfDescription(falseBranch?.plan || falseBranch?.title)
  })
}

export function defaultControlIfData(label?: string): ControlIfData {
  return controlIfDataSchema.parse({
    label,
    field: '',
    operator: 'truthy',
    configPending: true
  })
}

export function defaultControlSwitchData(label?: string): ControlSwitchData {
  return controlSwitchDataSchema.parse({
    label,
    field: 'kind',
    cases: [
      { id: 'a', label: 'Case A', value: 'a' },
      { id: 'b', label: 'Case B', value: 'b' }
    ],
    defaultCaseId: 'b'
  })
}

export function isExclusiveBranchSpec(spec: string): boolean {
  const s = spec.toLowerCase().trim()
  return (
    s.startsWith('control.if') ||
    s.startsWith('if ') ||
    s === 'if' ||
    s.startsWith('control.switch') ||
    s.startsWith('switch') ||
    s.startsWith('route.')
  )
}

export function isSwitchBranchSpec(spec: string): boolean {
  const s = spec.toLowerCase().trim()
  return s.startsWith('control.switch') || s.startsWith('switch') || s.startsWith('route.')
}
