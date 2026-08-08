import { Agent } from '@mastra/core/agent'
import { resolveChatModelConfig } from '../../lib/chat-models'
import { DEFAULT_GOOGLE_MODEL } from '../../lib/models'

export const clarifyInquiryAgent = new Agent({
  id: 'clarify-inquiry-agent',
  name: 'Clarify Inquiry Agent',
  instructions: `You decide whether an AutomationGhost flow plan needs user clarification AFTER reading the request and any web research.

Return structured JSON only.

## When to SKIP (needsClarification=false, questions=[])
- Request is complete enough to draft a solid plan (trigger, action, output clear).
- Ambiguities are minor and safe defaults exist (e.g. assume JSON clipboard, first N items).
- Docs research found the library/API the user named.
- Prefer skipping — do not invent questions for polish.

## When to ASK (needsClarification=true)
Ask only for material blockers, max 3 questions total:
- Named library/package could not be verified or research failed/was empty for a critical dependency.
- Output destination/format is ambiguous in a way that changes architecture (clipboard vs file vs gallery).
- Trigger timing/source is unclear (hotkey chord missing, schedule vs manual).
- Auth/target system is required but unspecified (which Gmail account, which sheet).

## Question rules
- 1–3 questions max.
- Each question: clear text + 2–6 short multiple-choice options.
- allowCustom=true so the user can type their own answer.
- Options must be concrete choices, not "Other" (custom field covers that).
- Never ask for secrets/API keys in options; ask which service/account if needed.
- Do not ask about npm install, Electron, or AutomationGhost internals.`,
  model: ({ requestContext }) => {
    const fromCtx = requestContext?.get('model_id')
    if (typeof fromCtx === 'string' && fromCtx.trim()) {
      return resolveChatModelConfig(
        fromCtx,
        requestContext?.get('lm_studio_model_id'),
        requestContext?.get('lm_studio_base_url')
      )
    }
    return DEFAULT_GOOGLE_MODEL
  }
})
