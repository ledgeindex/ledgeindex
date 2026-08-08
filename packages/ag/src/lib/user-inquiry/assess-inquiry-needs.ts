import { clarifyInquiryAgent } from '../../mastra/agents/clarify-inquiry-agent'
import { formatPlanningContextForPrompt, type PlanningContextBundle } from '../planning-context'
import {
  buildPlanningRequestContext,
  type PlanningModelSelection
} from '../planning-model'
import {
  clarifyInquiryDecisionSchema,
  type ClarifyInquiryDecision
} from './schema'

/** Dev home-test prompt embeds this — forces suspend without relying on the LLM. */
export const FORCE_CLARIFY_MARKER = '[AG_FORCE_CLARIFY]'

function forcedClarifyDecision(): ClarifyInquiryDecision {
  return {
    needsClarification: true,
    reason: 'Dev force-clarify marker — request is intentionally incomplete.',
    questions: [
      {
        id: 'delivery',
        text: 'Where should the final result go?',
        allowCustom: true,
        options: [
          { id: 'clipboard', label: 'System clipboard' },
          { id: 'notification', label: 'Desktop notification only' },
          { id: 'cards', label: 'Gallery cards + history' },
          { id: 'clipboard_and_notify', label: 'Clipboard and notification' }
        ]
      },
      {
        id: 'trigger',
        text: 'How should this automation start?',
        allowCustom: true,
        options: [
          { id: 'hotkey', label: 'Keyboard shortcut (you will name it)' },
          { id: 'manual', label: 'Manual Run button only' },
          { id: 'schedule', label: 'On a schedule' }
        ]
      },
      {
        id: 'scope',
        text: 'How many items should we process?',
        allowCustom: true,
        options: [
          { id: 'five', label: 'First 5' },
          { id: 'ten', label: 'First 10' },
          { id: 'twenty', label: 'First 20' }
        ]
      }
    ]
  }
}

export async function assessUserInquiryNeeds(input: {
  prompt: string
  planningContext?: PlanningContextBundle
  model?: PlanningModelSelection
}): Promise<ClarifyInquiryDecision> {
  if (input.prompt.includes(FORCE_CLARIFY_MARKER)) {
    return forcedClarifyDecision()
  }

  const researchBlock = input.planningContext
    ? `\n${formatPlanningContextForPrompt(input.planningContext)}\n`
    : '\n(No planning research context yet.)\n'

  const response = await clarifyInquiryAgent.generate(
    `User automation request:\n${input.prompt.trim()}\n${researchBlock}\nDecide if clarification is required before drafting the plan.`,
    {
      structuredOutput: { schema: clarifyInquiryDecisionSchema },
      requestContext: buildPlanningRequestContext(input.model)
    }
  )

  const raw = (response as { object?: unknown }).object
  const parsed = clarifyInquiryDecisionSchema.parse(raw ?? {})

  if (!parsed.needsClarification) {
    return { ...parsed, questions: [] }
  }

  return {
    ...parsed,
    questions: parsed.questions.slice(0, 3)
  }
}
