import type { ChatHistoryItem, ChatModelFunctionCall } from 'node-llama-cpp'
import { parseToolCallArguments, type OpenAiToolCall } from './openai-tools.js'

export type ChatMessage = {
  role?: string
  content?: string | Array<{ type?: string; text?: string }> | null
  /** Some clients still send UI-message `parts` instead of OpenAI `content`. */
  parts?: Array<{ type?: string; text?: string }>
  tool_calls?: OpenAiToolCall[]
  tool_call_id?: string
  name?: string
}

export function messageText(message: ChatMessage | undefined): string {
  if (!message) return ''
  const content = message.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const fromContent = content
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .filter(Boolean)
      .join('\n')
    if (fromContent) return fromContent
  }
  if (Array.isArray(message.parts)) {
    return message.parts
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

function systemPrompt(messages: ChatMessage[] | undefined): string | undefined {
  const parts =
    messages?.filter((m) => m.role === 'system').map(messageText).filter((t) => t.trim().length > 0) ??
    []
  return parts.length ? parts.join('\n\n') : undefined
}

function assistantToModelResponse(message: ChatMessage): ChatHistoryItem | null {
  const text = messageText(message).trim()
  const toolCalls = message.tool_calls ?? []
  const response: Array<string | ChatModelFunctionCall> = []
  if (text) response.push(text)
  for (const call of toolCalls) {
    const name = call.function?.name?.trim()
    if (!name) continue
    response.push({
      type: 'functionCall',
      name,
      params: parseToolCallArguments(call.function?.arguments),
      // Filled when matching role:tool messages arrive.
      result: null
    })
  }
  if (response.length === 0) return null
  return { type: 'model', response }
}

function applyToolResult(
  history: ChatHistoryItem[],
  toolCallId: string | undefined,
  resultText: string,
  toolName?: string
): void {
  for (let i = history.length - 1; i >= 0; i--) {
    const item = history[i]
    if (item?.type !== 'model') continue
    for (const part of item.response) {
      if (typeof part === 'string' || part.type !== 'functionCall') continue
      if (part.result != null) continue
      if (toolName && part.name !== toolName) continue
      // OpenAI tool_call_id doesn't map 1:1 into llama history; match first pending call.
      void toolCallId
      part.result = resultText
      return
    }
  }
}

/**
 * Build a full LlamaChat history from OpenAI chat messages (including tool calls/results).
 * Used with LlamaChat.generateResponse — history already ends at the point the model should reply.
 */
export function openAiMessagesToLlamaChatHistory(
  messages: ChatMessage[] | undefined
): ChatHistoryItem[] {
  const history: ChatHistoryItem[] = []
  const system = systemPrompt(messages)
  if (system) history.push({ type: 'system', text: system })

  for (const message of messages ?? []) {
    if (message.role === 'system') continue
    if (message.role === 'user') {
      const text = messageText(message).trim()
      if (text) history.push({ type: 'user', text })
      continue
    }
    if (message.role === 'assistant' || message.role === 'model') {
      const item = assistantToModelResponse(message)
      if (item) history.push(item)
      continue
    }
    if (message.role === 'tool') {
      applyToolResult(
        history,
        message.tool_call_id,
        messageText(message) || '',
        message.name
      )
    }
  }

  return history
}

/**
 * Split OpenAI chat messages into:
 * - system prompt
 * - prior turns for LlamaChatSession.setChatHistory
 * - latest user text for session.prompt()
 *
 * Without this, each request only saw the last user line and forgot the transcript.
 */
export function openAiMessagesToChatSessionInput(
  messages: ChatMessage[] | undefined,
  fallbackPrompt: string
): {
  system?: string
  history: ChatHistoryItem[]
  prompt: string
} {
  const system = systemPrompt(messages)
  const turns = (messages ?? []).filter(
    (message) => message.role === 'user' || message.role === 'assistant' || message.role === 'model'
  )

  let lastUserIdx = -1
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i]?.role === 'user' && messageText(turns[i]).trim()) {
      lastUserIdx = i
      break
    }
  }

  if (lastUserIdx === -1) {
    return { system, history: [], prompt: fallbackPrompt }
  }

  const prompt = messageText(turns[lastUserIdx]) || fallbackPrompt
  const history: ChatHistoryItem[] = []
  for (const message of turns.slice(0, lastUserIdx)) {
    const text = messageText(message).trim()
    if (!text && !(message.tool_calls && message.tool_calls.length > 0)) continue
    if (message.role === 'user') {
      if (text) history.push({ type: 'user', text })
    } else {
      const item = assistantToModelResponse(message)
      if (item) history.push(item)
    }
  }

  return { system, history, prompt }
}

export function messagesNeedToolAwareChat(messages: ChatMessage[] | undefined): boolean {
  return (messages ?? []).some(
    (message) =>
      message.role === 'tool' ||
      (Array.isArray(message.tool_calls) && message.tool_calls.length > 0)
  )
}
