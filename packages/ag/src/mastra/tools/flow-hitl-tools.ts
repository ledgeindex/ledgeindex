import { createTool } from '@mastra/core/tools'
import { z } from 'zod'

/** Shared HITL pending payload — UI shows Approve/Reject; no side effects until approved. */
const hitlPendingSchema = z.object({
  status: z.literal('awaiting_approval'),
  tool: z.string(),
  summary: z.string(),
  detail: z.string().optional(),
  revisionPrompt: z.string().optional()
})

/**
 * Demo HITL tool. Call when the user says "ping hitl" (or clearly asks to test approval).
 * Does nothing until the desktop UI Approves.
 */
export const hitlPingTestTool = createTool({
  id: 'hitl_ping_test',
  description:
    'Human-in-the-loop DEMO. Call this when the user says "ping hitl" or asks to test HITL / tool approval. Returns awaiting_approval — do not claim success until they approve in the UI.',
  inputSchema: z.object({
    message: z
      .string()
      .default('HITL ping')
      .describe('Short label shown on the approval card')
  }),
  outputSchema: hitlPendingSchema,
  execute: async (input) => {
    const message = input.message?.trim() || 'HITL ping'
    return {
      status: 'awaiting_approval' as const,
      tool: 'hitl_ping_test',
      summary: message,
      detail: 'Demo only — Approve to confirm the approval UI works. No files change.'
    }
  }
})

/**
 * Versioned plan revision gate. Call when the user wants the automation plan changed
 * (new phases, filter rules, rejected-jobs table, etc.). Desktop Approves → draft candidate.
 */
export const proposePlanRevisionTool = createTool({
  id: 'propose_plan_revision',
  description:
    'HITL plan revision only. Call for STRUCTURAL / plan-level changes that need a candidate rebuild + new version (add/remove/reorder phases, whole-pipeline replan). Do NOT call for surgical single-node edits — those should use workspace read/edit on nodes/{id}.ts or flow.json directly. Returns awaiting_approval.',
  inputSchema: z.object({
    summary: z
      .string()
      .describe('One-sentence summary of the proposed change for the approval card'),
    revisionPrompt: z
      .string()
      .describe('Full instruction to send to the plan revision agent after approval')
  }),
  outputSchema: hitlPendingSchema,
  execute: async (input) => {
    return {
      status: 'awaiting_approval' as const,
      tool: 'propose_plan_revision',
      summary: input.summary.trim(),
      revisionPrompt: input.revisionPrompt.trim(),
      detail: 'After Approve, a candidate plan draft will be prepared for review (Confirm/Discard).'
    }
  }
})
