import { RequestContext } from '@mastra/core/request-context'
import { pinShaperAgent } from '../mastra/agents/pin-shaper-agent'
import {
  activeToolIdsForPinShape,
  readPinShapeArtifacts,
  resetPinShapeContext
} from '../mastra/tools/crud-pin-tools'
import {
  collectPinsFromToolResults,
  summarizeToolFailures
} from './pin-shape-tool-results'
import {
  pinShapeRequestSchema,
  type PinShapeRequest,
  type PinShapeResponse
} from './pin-shape-types'
import { agLogError, agLogInfo, agLogSummary } from './ag-log'
import { resolveFlowModel } from './flow-model-provider'
import type { PinShapeArtifact } from './pin-shape-types'

function sortPinsByConfiguredOrder(
  pins: PinShapeArtifact[],
  input: PinShapeRequest
): PinShapeArtifact[] {
  if (input.mode === 'create' && input.pinTypes && input.pinTypes.length > 0) {
    const order = new Map(input.pinTypes.map((pinType, index) => [pinType, index]))
    return [...pins].sort((left, right) => {
      const leftIndex = order.get(left.pinType) ?? Number.MAX_SAFE_INTEGER
      const rightIndex = order.get(right.pinType) ?? Number.MAX_SAFE_INTEGER
      return leftIndex - rightIndex
    })
  }

  if (input.mode === 'update' && input.updateTargets && input.updateTargets.length > 0) {
    const order = new Map(input.updateTargets.map((target, index) => [target.pinId, index]))
    return [...pins].sort((left, right) => {
      const leftIndex = order.get(left.pinId) ?? Number.MAX_SAFE_INTEGER
      const rightIndex = order.get(right.pinId) ?? Number.MAX_SAFE_INTEGER
      return leftIndex - rightIndex
    })
  }

  return pins
}

function buildPrompt(input: PinShapeRequest): string {
  const lines = [
    `Flow id: ${input.flowId}`,
    `Mode: ${input.mode}`,
    '',
    'Upstream JSON from the automation step:',
    '```json',
    JSON.stringify(input.upstream, null, 2),
    '```'
  ]

  if (input.userInstructions?.trim()) {
    lines.push('', 'User instructions:', input.userInstructions.trim())
  }

  if (input.mode === 'create') {
    const types =
      input.pinTypes && input.pinTypes.length > 0
        ? input.pinTypes.join(', ')
        : 'choose appropriate types from allowed tools'
    lines.push('', `Required pin types: ${types}`)
    lines.push('Call create_<pinType>_pin once per required type. Do not pass pinId — pinId is generated automatically.')
  } else {
    lines.push('', 'Update targets (only these pins may be updated):')
    for (const target of input.updateTargets ?? []) {
      lines.push(
        `- pinId=${target.pinId} pinType=${target.pinType}${target.label ? ` label=${target.label}` : ''}`
      )
      if (target.pin_config) {
        lines.push('  current pin_config:', JSON.stringify(target.pin_config, null, 2))
      }
    }
    lines.push('Call update_<pinType>_pin with pinId for each target.')
  }

  return lines.join('\n')
}

export async function shapePinsWithAgent(raw: unknown): Promise<PinShapeResponse> {
  const parsed = pinShapeRequestSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      pins: [],
      error: parsed.error.issues.map((i) => i.message).join('; ')
    }
  }

  const input = parsed.data

  agLogInfo('pin-shape', 'Pin shape request received', {
    flowId: input.flowId,
    mode: input.mode,
    model: resolveFlowModel(input.model),
    pinTypes: input.pinTypes,
    updateTargetCount: input.updateTargets?.length ?? 0
  })

  if (input.mode === 'create') {
    if (input.pinTypes && input.pinTypes.length === 0) {
      return { ok: false, pins: [], error: 'pinTypes must not be empty in create mode' }
    }
  } else if (!input.updateTargets || input.updateTargets.length === 0) {
    return { ok: false, pins: [], error: 'updateTargets required in update mode' }
  }

  const activeTools = activeToolIdsForPinShape(input)
  if (activeTools.length === 0) {
    return { ok: false, pins: [], error: 'No pin tools available for this configuration' }
  }

  const requestContext = new RequestContext()
  const model = resolveFlowModel(input.model)
  resetPinShapeContext(requestContext, {
    flowId: input.flowId,
    mode: input.mode,
    updateTargets: input.updateTargets
  })
  requestContext.set('flow_model', model)
  if (input.lmStudioModelId?.trim()) {
    requestContext.set('lm_studio_model_id', input.lmStudioModelId.trim())
  }
  if (input.lmStudioBaseUrl?.trim()) {
    requestContext.set('lm_studio_base_url', input.lmStudioBaseUrl.trim())
  }

  type AgentResult = Awaited<ReturnType<typeof pinShaperAgent.generate>>
  const agentResults: AgentResult[] = []
  try {
    const hasExplicitCreateTypes =
      input.mode === 'create' && Boolean(input.pinTypes?.length)

    if (hasExplicitCreateTypes) {
      for (const toolName of activeTools) {
        let retryFeedback = ''
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          agLogInfo('pin-shape', 'Running focused pin-shaper tool call', {
            flowId: input.flowId,
            model,
            toolName,
            attempt
          })
          const result = await pinShaperAgent.generate(
            `${buildPrompt(input)}\n\nFor this call, invoke exactly ${toolName} once. Do not call another pin tool.${retryFeedback}`,
            {
              requestContext,
              toolChoice: { type: 'tool', toolName },
              activeTools: [toolName],
              maxSteps: 1
            }
          )
          agentResults.push(result)

          if (collectPinsFromToolResults(result).length > 0) {
            break
          }

          const failures = summarizeToolFailures(result)
          retryFeedback = `\n\nThe previous call failed validation: ${failures.join(' | ') || 'no valid pin artifact was returned'}. Correct the tool arguments. Populate every requested field from the upstream JSON; never use null placeholders.`
        }
      }
    } else {
      const maxSteps = Math.min(Math.max(1, input.updateTargets?.length ?? 1) * 4, 24)
      agLogInfo('pin-shape', 'Running pin-shaper agent', {
        flowId: input.flowId,
        model,
        activeTools,
        maxSteps
      })
      agentResults.push(
        await pinShaperAgent.generate(buildPrompt(input), {
          requestContext,
          toolChoice: 'required',
          activeTools,
          maxSteps
        })
      )
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    agLogError('pin-shape', 'Pin shaper agent failed', error)
    return { ok: false, pins: [], error: message }
  }

  const contextPins = readPinShapeArtifacts(requestContext)
  const resultPins = agentResults.flatMap((result) => collectPinsFromToolResults(result))
  const pins = sortPinsByConfiguredOrder(
    [
      ...new Map(
        [...contextPins, ...resultPins].map((pin) => [
          `${pin.pinId}:${pin.pinType}`,
          pin
        ])
      ).values()
    ],
    input
  )
  const toolFailures = [
    ...new Set(agentResults.flatMap((result) => summarizeToolFailures(result)))
  ]

  if (pins.length === 0) {
    const detail =
      toolFailures.length > 0
        ? toolFailures.slice(0, 4).join(' | ')
        : 'Agent finished without producing pin artifacts — no tool results captured'
    agLogError('pin-shape', 'Pin shaper produced no artifacts', {
      flowId: input.flowId,
      model,
      activeTools,
      toolFailures,
      contextPinCount: contextPins.length,
      resultPinCount: resultPins.length,
      finishReasons: agentResults.map((result) => result.finishReason),
      toolResultCount: agentResults.reduce(
        (count, result) => count + (result.toolResults?.length ?? 0),
        0
      ),
      stepCount: agentResults.reduce(
        (count, result) => count + (result.steps?.length ?? 0),
        0
      )
    })
    return {
      ok: false,
      pins: [],
      error: detail,
      toolErrors: toolFailures
    }
  }

  if (contextPins.length === 0 && resultPins.length > 0) {
    agLogInfo('pin-shape', 'Recovered pin artifacts from agent tool results (requestContext was empty)', {
      flowId: input.flowId,
      pinCount: resultPins.length
    })
  }

  if (input.mode === 'create' && input.pinTypes && input.pinTypes.length > 0) {
    const produced = new Set(pins.map((p) => p.pinType))
    const missing = input.pinTypes.filter((t) => !produced.has(t))
    if (missing.length > 0) {
      const failureDetail =
        toolFailures.length > 0 ? ` — ${toolFailures.slice(0, 4).join(' | ')}` : ''
      return {
        ok: false,
        pins,
        error: `Missing required pin types: ${missing.join(', ')}${failureDetail}`,
        toolErrors: toolFailures
      }
    }
  }

  if (input.mode === 'update' && input.updateTargets) {
    const producedIds = new Set(pins.map((p) => p.pinId))
    const missing = input.updateTargets.filter((t) => !producedIds.has(t.pinId))
    if (missing.length > 0) {
      const failureDetail =
        toolFailures.length > 0 ? ` — ${toolFailures.slice(0, 4).join(' | ')}` : ''
      return {
        ok: false,
        pins,
        error: `Did not update all targets: ${missing.map((m) => m.pinId).join(', ')}${failureDetail}`,
        toolErrors: toolFailures
      }
    }
  }

  agLogSummary('pin-shape', 'Pin shape complete', {
    flowId: input.flowId,
    pinCount: pins.length,
    pinTypes: pins.map((p) => p.pinType)
  })

  return { ok: true, pins }
}
