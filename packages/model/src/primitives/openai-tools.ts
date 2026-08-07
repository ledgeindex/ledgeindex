import { randomUUID } from 'node:crypto'
import type { ChatModelFunctions, GbnfJsonSchema } from 'node-llama-cpp'

/** OpenAI chat-completions `tools[]` entry. */
export type OpenAiTool = {
  type?: string
  function?: {
    name?: string
    description?: string
    parameters?: Record<string, unknown>
  }
}

export type OpenAiToolCall = {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export function openAiToolsToChatModelFunctions(
  tools: OpenAiTool[] | undefined
): ChatModelFunctions | undefined {
  if (!tools?.length) return undefined
  const functions: Record<string, { description?: string; params?: GbnfJsonSchema }> = {}
  for (const tool of tools) {
    if (tool.type && tool.type !== 'function') continue
    const name = tool.function?.name?.trim()
    if (!name) continue
    functions[name] = {
      ...(tool.function?.description ? { description: tool.function.description } : {}),
      ...(tool.function?.parameters && typeof tool.function.parameters === 'object'
        ? { params: tool.function.parameters as GbnfJsonSchema }
        : {})
    }
  }
  return Object.keys(functions).length > 0 ? functions : undefined
}

export function llamaFunctionCallsToOpenAiToolCalls(
  calls: Array<{ functionName: string; params: unknown }> | undefined
): OpenAiToolCall[] {
  if (!calls?.length) return []
  return calls.map((call) => ({
    id: `call_${randomUUID().replace(/-/g, '').slice(0, 24)}`,
    type: 'function' as const,
    function: {
      name: call.functionName,
      arguments: JSON.stringify(call.params ?? {})
    }
  }))
}

export function parseToolCallArguments(raw: string | undefined): unknown {
  if (!raw?.trim()) return {}
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return { raw }
  }
}
