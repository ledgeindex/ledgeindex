import { registerApiRoute } from '@mastra/core/server'
import { flowAgentRunInputSchema, runFlowAgent } from '../lib/run-flow-structured-agent'

export function registerFlowAgentRoutes() {
  return [
    registerApiRoute('/ag/flow-agent/run', {
      method: 'POST',
      requiresAuth: false,
      handler: async (c) => {
        const body = await c.req.json()
        const parsed = flowAgentRunInputSchema.safeParse(body)
        if (!parsed.success) {
          return c.json({ ok: false, error: parsed.error.message }, 400)
        }
        const result = await runFlowAgent(parsed.data)
        return c.json(result, result.ok ? 200 : 422)
      }
    })
  ]
}
