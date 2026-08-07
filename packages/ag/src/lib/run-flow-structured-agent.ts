import { RequestContext } from '@mastra/core/request-context'
import { z } from 'zod'
import { flowStructuredAgent } from '../mastra/agents/flow-structured-agent'
import { flowTextAgent } from '../mastra/agents/flow-text-agent'
import { resolveFlowModel } from './flow-model-provider'
import { agLogInfo, agLogError } from './ag-log'

export const flowAgentRunInputSchema = z.object({
  mode: z.enum(['structured', 'text']).default('structured'),
  instructions: z.string().min(1),
  userMessage: z.string().min(1),
  /** Required when mode is structured — JSON Schema for structuredOutput.schema */
  outputSchema: z.record(z.string(), z.unknown()).optional(),
  modelId: z.string().optional(),
  lmStudioModelId: z.string().optional(),
  lmStudioBaseUrl: z.string().optional()
})

export type FlowAgentRunInput = z.infer<typeof flowAgentRunInputSchema>

export type FlowAgentRunResult =
  | { ok: true; mode: 'structured'; object: unknown; text?: string }
  | { ok: true; mode: 'text'; text: string }
  | { ok: false; error: string }

function buildRequestContext(input: FlowAgentRunInput): RequestContext {
  const modelId = resolveFlowModel(input.modelId)
  const requestContext = new RequestContext()
  requestContext.set('agent_instructions', input.instructions)
  requestContext.set('flow_model', modelId)
  if (input.lmStudioModelId) requestContext.set('lm_studio_model_id', input.lmStudioModelId)
  if (input.lmStudioBaseUrl) requestContext.set('lm_studio_base_url', input.lmStudioBaseUrl)
  return requestContext
}

/**
 * Run built-in flow agents: structured (JSON Schema) or free text.
 */
export async function runFlowAgent(raw: FlowAgentRunInput): Promise<FlowAgentRunResult> {
  const input = flowAgentRunInputSchema.parse(raw)
  const requestContext = buildRequestContext(input)
  const modelId = resolveFlowModel(input.modelId)

  if (input.mode === 'text') {
    agLogInfo('flow-agent', 'Text generate', { modelId })
    try {
      const result = await flowTextAgent.generate(input.userMessage, { requestContext })
      return {
        ok: true,
        mode: 'text',
        text: result.text ?? ''
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      agLogError('flow-agent', 'Text generate failed', error)
      return { ok: false, error: message }
    }
  }

  if (!input.outputSchema || typeof input.outputSchema !== 'object') {
    return { ok: false, error: 'outputSchema is required for structured mode' }
  }

  agLogInfo('flow-agent', 'Structured generate', {
    modelId,
    schemaKeys: Object.keys(
      (input.outputSchema as { properties?: object }).properties ?? input.outputSchema
    )
  })

  try {
    const result = await flowStructuredAgent.generate(input.userMessage, {
      requestContext,
      structuredOutput: {
        schema: input.outputSchema as never
      }
    })

    const object = (result as { object?: unknown }).object
    if (object === undefined) {
      return {
        ok: false,
        error: 'Structured agent returned no object — check schema / model support'
      }
    }

    return {
      ok: true,
      mode: 'structured',
      object,
      text: typeof result.text === 'string' ? result.text : undefined
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    agLogError('flow-agent', 'Structured generate failed', error)
    return { ok: false, error: message }
  }
}

/** @deprecated use runFlowAgent */
export async function runFlowStructuredAgent(
  raw: Omit<FlowAgentRunInput, 'mode'> & { mode?: 'structured' }
): Promise<FlowAgentRunResult> {
  return runFlowAgent({ ...raw, mode: 'structured' })
}
