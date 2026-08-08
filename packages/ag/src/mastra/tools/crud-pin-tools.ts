import { createTool } from '@mastra/core/tools'
import type { RequestContext } from '@mastra/core/request-context'
import { z } from 'zod'
import { agLogError } from '../../lib/ag-log'
import {
  AUTOMATIONGHOST_PIN_TYPES_V1,
  createPinToolId,
  updatePinToolId,
  type AutomationGhostPinTypeV1
} from '../../lib/automationghost-pin-types'
import {
  buildCreateInputSchema,
  buildUpdateInputSchema,
  normalizePinConfigForCreate,
  validatePinConfigStrict
} from '../../lib/pin-crud-schema'
import type { PinShapeArtifact } from '../../lib/pin-shape-types'

const PIN_ARTIFACTS_KEY = 'pin_shape_artifacts'
const FLOW_ID_KEY = 'pin_shape_flow_id'
const PIN_SHAPE_MODE_KEY = 'pin_shape_mode'

const pinToolOutputSchema = z.object({
  ok: z.boolean(),
  action: z.enum(['create', 'update']).optional(),
  pinId: z.string().optional(),
  pinType: z.string().optional(),
  title: z.string().optional(),
  label: z.string().optional(),
  pinConfig: z.record(z.any()).optional(),
  message: z.string().optional(),
  errorCode: z.string().optional(),
  errors: z.array(z.string()).optional()
})

export type CrudPinToolResult = z.infer<typeof pinToolOutputSchema>

function getCtx(
  context: RequestContext | { requestContext?: RequestContext } | undefined
): RequestContext | undefined {
  if (!context) return undefined
  if (context instanceof Object && 'get' in context && typeof context.get === 'function') {
    return context as RequestContext
  }
  return (context as { requestContext?: RequestContext }).requestContext
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function createInvalidPinConfigError(
  toolName: string,
  pinType: string,
  validationErrors: string[]
): CrudPinToolResult {
  return {
    ok: false,
    errorCode: 'INVALID_PIN_CONFIG',
    pinType,
    message: validationErrors.join('; '),
    errors: validationErrors
  }
}

function readArtifacts(ctx: RequestContext | undefined): PinShapeArtifact[] {
  const existing = ctx?.get(PIN_ARTIFACTS_KEY)
  return Array.isArray(existing) ? (existing as PinShapeArtifact[]) : []
}

function pushArtifact(ctx: RequestContext | undefined, artifact: PinShapeArtifact): void {
  if (!ctx) return
  const next = [...readArtifacts(ctx), artifact]
  ctx.set(PIN_ARTIFACTS_KEY, next)
}

function readFlowId(ctx: RequestContext | undefined): string {
  return String(ctx?.get(FLOW_ID_KEY) ?? 'flow')
}

function newLocalPinId(flowId: string, pinType: string): string {
  const slug = pinType.replace(/-/g, '')
  return `ag-${flowId.slice(0, 8)}-${slug}-${crypto.randomUUID().slice(0, 8)}`
}

function isAutomationGhostPinType(pinType: string): pinType is AutomationGhostPinTypeV1 {
  return (AUTOMATIONGHOST_PIN_TYPES_V1 as readonly string[]).includes(pinType)
}

function executeCreatePin(
  toolName: string,
  pinType: AutomationGhostPinTypeV1,
  input: { title?: string; pin_config?: Record<string, unknown> },
  ctx: RequestContext | undefined
): CrudPinToolResult {
  const pinTypeLabel = pinType.replace(/-/g, ' ')

  if (!ctx) {
    agLogError('pin-tool', `${toolName} missing requestContext — artifact will be recovered from tool result only`)
  }

  const title =
    input.title ??
    String(
      (isPlainObject(input.pin_config) ? input.pin_config.title : undefined) ?? `${pinType} pin`
    )
  const rawPinConfig = { ...((input.pin_config ?? {}) as Record<string, unknown>) }
  const normalizedPinConfig = normalizePinConfigForCreate(pinType, rawPinConfig, title)
  const validationErrors = validatePinConfigStrict(pinType, normalizedPinConfig)
  if (validationErrors.length > 0) {
    agLogError('pin-tool', `${toolName} validation failed`, { pinType, errors: validationErrors })
    return createInvalidPinConfigError(toolName, pinType, validationErrors)
  }

  const pinId = newLocalPinId(readFlowId(ctx), pinType)
  const artifact: PinShapeArtifact = {
    pinId,
    pinType,
    title,
    pin_config: normalizedPinConfig
  }
  pushArtifact(ctx, artifact)

  return {
    ok: true,
    action: 'create',
    pinId,
    pinType,
    title,
    pinConfig: normalizedPinConfig,
    label: `${pinTypeLabel} pin created`,
    message: `${pinTypeLabel} pin created`
  }
}

function executeUpdatePin(
  toolName: string,
  pinType: AutomationGhostPinTypeV1,
  input: { pinId: string; title?: string; pin_config?: Record<string, unknown> },
  ctx: RequestContext | undefined
): CrudPinToolResult {
  const pinTypeLabel = pinType.replace(/-/g, ' ')
  const targets = (ctx?.get('pin_shape_update_targets') as PinShapeArtifact[]) ?? []
  const target = targets.find((t) => t.pinId === input.pinId && t.pinType === pinType)
  if (!target) {
    return {
      ok: false,
      action: 'update',
      pinType,
      errorCode: 'PIN_NOT_IN_TARGETS',
      message: `pinId ${input.pinId} is not an allowed update target for ${pinType}`
    }
  }

  const existingPinConfig = isPlainObject(target.pin_config) ? target.pin_config : {}
  const incomingPinConfig = isPlainObject(input.pin_config) ? input.pin_config : {}
  const updatedTitle =
    input.title ??
    (typeof incomingPinConfig.title === 'string' ? incomingPinConfig.title : undefined) ??
    target.title ??
    `${pinType} pin`

  const mergedForUpdate = { ...existingPinConfig, ...incomingPinConfig }
  const normalizedPinConfig = normalizePinConfigForCreate(pinType, mergedForUpdate, updatedTitle)
  const validationErrors = validatePinConfigStrict(pinType, normalizedPinConfig)
  if (validationErrors.length > 0) {
    agLogError('pin-tool', `${toolName} validation failed`, {
      pinId: input.pinId,
      pinType,
      errors: validationErrors
    })
    return createInvalidPinConfigError(toolName, pinType, validationErrors)
  }

  const artifact: PinShapeArtifact = {
    pinId: input.pinId,
    pinType,
    title: updatedTitle,
    pin_config: normalizedPinConfig
  }
  pushArtifact(ctx, artifact)

  return {
    ok: true,
    action: 'update',
    pinId: input.pinId,
    pinType,
    title: updatedTitle,
    pinConfig: normalizedPinConfig,
    label: `${pinTypeLabel} pin updated`,
    message: `${pinTypeLabel} pin updated`
  }
}

function buildCreatePinTool(pinType: AutomationGhostPinTypeV1) {
  const toolName = createPinToolId(pinType)

  return createTool({
    id: toolName,
    description: `Create a new ${pinType} pin. Generates pinId automatically — do not pass pinId.`,
    inputSchema: buildCreateInputSchema(pinType),
    outputSchema: pinToolOutputSchema,
    execute: async (input, context) => {
      const ctx = getCtx(context)
      return executeCreatePin(toolName, pinType, input, ctx)
    }
  })
}

function buildUpdatePinTool(pinType: AutomationGhostPinTypeV1) {
  const toolName = updatePinToolId(pinType)

  return createTool({
    id: toolName,
    description: `Update an existing ${pinType} pin. pinId must match one of the listed update targets.`,
    inputSchema: buildUpdateInputSchema(pinType),
    outputSchema: pinToolOutputSchema,
    execute: async (input, context) => {
      const ctx = getCtx(context)
      return executeUpdatePin(toolName, pinType, input, ctx)
    }
  })
}

export const createPinTools = Object.fromEntries(
  AUTOMATIONGHOST_PIN_TYPES_V1.map((pinType) => [createPinToolId(pinType), buildCreatePinTool(pinType)])
) as Record<string, ReturnType<typeof createTool>>

export const updatePinTools = Object.fromEntries(
  AUTOMATIONGHOST_PIN_TYPES_V1.map((pinType) => [updatePinToolId(pinType), buildUpdatePinTool(pinType)])
) as Record<string, ReturnType<typeof createTool>>

/** All pin-shaper tools — agent registers both; activeTools filters by flow mode. */
export const pinShaperTools = {
  ...createPinTools,
  ...updatePinTools
} as Record<string, ReturnType<typeof createTool>>

export function activeToolIdsForPinShape(input: {
  mode: 'create' | 'update'
  pinTypes?: string[]
  updateTargets?: Array<{ pinType: string }>
}): string[] {
  if (input.mode === 'create') {
    const types =
      input.pinTypes && input.pinTypes.length > 0
        ? input.pinTypes.filter(isAutomationGhostPinType)
        : [...AUTOMATIONGHOST_PIN_TYPES_V1]
    return types.map((pinType) => createPinToolId(pinType))
  }

  const types: AutomationGhostPinTypeV1[] = []
  const seen = new Set<string>()
  for (const target of input.updateTargets ?? []) {
    if (!isAutomationGhostPinType(target.pinType)) continue
    if (seen.has(target.pinType)) continue
    seen.add(target.pinType)
    types.push(target.pinType)
  }
  return types.map((pinType) => updatePinToolId(pinType))
}

export function resetPinShapeContext(
  requestContext: RequestContext,
  input: {
    flowId: string
    mode?: 'create' | 'update'
    updateTargets?: Array<{
      pinId: string
      pinType: string
      title?: string
      pin_config?: Record<string, unknown>
    }>
  }
): void {
  requestContext.set(PIN_ARTIFACTS_KEY, [])
  requestContext.set(FLOW_ID_KEY, input.flowId)
  requestContext.set(PIN_SHAPE_MODE_KEY, input.mode ?? 'create')
  if (input.updateTargets) {
    requestContext.set('pin_shape_update_targets', input.updateTargets)
  } else {
    requestContext.set('pin_shape_update_targets', [])
  }
}

export function readPinShapeArtifacts(requestContext: RequestContext): PinShapeArtifact[] {
  return readArtifacts(requestContext)
}
