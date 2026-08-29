import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import {
  cleanQuestionForRetrieve,
  fallbackIntentForRerank,
} from "@ledgeindex/core/query/query-intent.js";
import { mergeRewriteWithCatalogPhrases } from "@ledgeindex/core/query/rank-catalog-pages.js";
import type { MetadataCatalogPage } from "./metadata-catalog.js";
import {
  primaryAuxiliaryModelId,
  resolveRewriteModelConfig,
} from "../llm/chat-model-config.js";
import { agentStructuredOutput } from "../llm/agent-structured-output.js";

const rewriteOutputSchema = z.object({
  topicScope: z.enum(["single", "multi"]),
  canonicalQuestion: z.string().min(3).max(220).optional(),
  /** Natural-language search queries (embedding + BM25 use the same text). */
  queries: z.array(z.string().min(3).max(220)).min(1),
});

export type RewriteTopicScope = "single" | "multi";

/** Deterministic rewrite — topicScope and query variants should not flicker per run. */
const REWRITE_TEMPERATURE = 0;

export function clipRetrievalHistoryText(
  text: string,
  maxChars = 900,
): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  const headChars = Math.floor(maxChars / 3);
  const tailChars = maxChars - headChars - 1;
  return `${normalized.slice(0, headChars)}…${normalized.slice(-tailChars)}`;
}

export function resolveEvidenceQuestion(
  originalQuestion: string,
  canonicalQuestions: readonly (string | undefined)[],
): string {
  return (
    canonicalQuestions
      .map((question) => question?.trim())
      .find((question): question is string => Boolean(question)) ??
    originalQuestion.trim()
  );
}

export function buildRewritePrompt(input: {
  question: string;
  catalogText: string;
  history: string;
  sourceProfileHint?: string;
}): string {
  return `<conversation_history>
${input.history}
</conversation_history>

<source_profile>
${input.sourceProfileHint?.trim() || "No source profile available."}
</source_profile>

<source_catalog>
${input.catalogText}
</source_catalog>

<latest_user_message>
${input.question}
</latest_user_message>`;
}

export type RewriteResult = {
  /** Generated NL variants plus catalog title queries; retrieve also includes the user question. */
  queries: string[];
  /** Corrected, intent-preserving question used for cross-encoder reranking. */
  rerankQuery: string;
  /** Catalog page titles appended after the LLM variants. */
  catalogQueries: string[];
  topicScope: RewriteTopicScope;
  method: "llm" | "fallback";
  rewriteModelId: string;
};

function attachCatalogQueries(
  question: string,
  rewriteQueries: string[],
  topicScope: RewriteTopicScope,
  pages: MetadataCatalogPage[] | null | undefined,
): { queries: string[]; catalogQueries: string[] } {
  return mergeRewriteWithCatalogPhrases({
    question,
    rewriteQueries,
    pages,
    topicScope,
  });
}

function fallbackRewrite(
  question: string,
  rewriteModelId: string,
  pages?: MetadataCatalogPage[] | null,
): RewriteResult {
  const cleaned = cleanQuestionForRetrieve(question);
  const seed = cleaned ? [cleaned] : [question.trim().slice(0, 120)];
  return {
    ...attachCatalogQueries(question, seed, "single", pages),
    rerankQuery: cleaned || question.trim().slice(0, 220),
    topicScope: "single",
    method: "fallback",
    rewriteModelId,
  };
}

export async function rewriteQueries(input: {
  question: string;
  catalogText: string;
  history: string;
  pages?: MetadataCatalogPage[] | null;
  sourceProfileHint?: string;
  requestContext?: { get?: (key: string) => unknown };
}): Promise<RewriteResult> {
  const model = resolveRewriteModelConfig(input.requestContext);
  const rewriteModelId = primaryAuxiliaryModelId(input.requestContext);

  const agent = new Agent({
    id: "query-rewrite-agent",
    name: "Query Rewrite Agent",
    instructions: `Generate natural-language search queries for documentation retrieval (LlamaIndex-style query generation).

Decide topicScope first:
- "single": ONE documentation area. Multiple clauses about the same area stay together.
  Example: "How do I configure auth and session expiry?" → same auth area; rephrase the complete request.
- "multi": DISTINCT documentation areas → one query per area, ordered by importance.
  Example: "What is billing and how do I set up webhooks?" → separate queries when catalog shows different sections.

Conversation resolution is mandatory and happens before query generation:
- First resolve canonicalQuestion from the latest user message and conversation history.
- If the latest message is an acceptance such as "yes", "show me", "please do", or "tell me more", identify what the assistant most recently offered.
- A general acceptance applies to every topic in the assistant's latest offer unless the user selected only one.
- Do not fall back to the user's earlier question when the assistant's latest message offered a new next step.
- Set topicScope from the resolved canonicalQuestion, not from the literal latest message.
- Generate every query from canonicalQuestion, never directly from an ambiguous acknowledgement.

Follow-up example:
History assistant: "Would you like to explore Deployment & CI/CD, Studio Deployment, and Manual Installation?"
Latest user message: "yes"
canonicalQuestion: "Explain Mastra deployment and CI/CD, Studio deployment, and manual installation."
topicScope: "multi"
Queries should cover those three offered topics. They must not repeat an earlier "basic setup" question.

Rewrite the resolved meaning, not the catalog:
- Every query must be a semantic rephrasing of the user's complete question.
- Preserve the product names, entities, constraints, and requested outcome.
- Use vocabulary from the page catalog to make the question more precise.
- Use the source profile only to understand scope and topic vocabulary. Do not copy it as a search query.
- Each query must communicate the user's request when read without the catalog.
- Do not substitute a related page title for the user's question.
- Do not broaden the question into neighboring topics the user did not ask about.
- Resolve follow-ups from conversation history before rewriting.

Example:
Original: "what is the basic setup for mastra and ai elements"
Good:
- "How do I set up Mastra with AI Elements?"
- "What steps are required to integrate AI Elements into a Mastra project?"
Bad:
- "Get started"
- "Quickstart"
- "Installation"

Output:
1. topicScope — "single" or "multi".
2. canonicalQuestion — rewrite the user's complete question with spelling and grammar corrected. Preserve product names, identifiers, code, and intent. Use documentation terminology when the catalog provides it.
3. queries — semantic rephrasings of the complete user question, using catalog vocabulary, suitable for BOTH vector search and keyword search.

The retrieve pipeline always runs the user's original question as well; your queries are additional variants fused with RRF.`,
    model,
  });

  try {
    const object = await agentStructuredOutput(
      agent,
      buildRewritePrompt(input),
      rewriteOutputSchema,
      { temperature: REWRITE_TEMPERATURE },
    );
    if (object && object.queries.length > 0) {
      const topicScope: RewriteTopicScope =
        object.topicScope === "multi" ? "multi" : "single";
      return {
        ...attachCatalogQueries(
          input.question,
          object.queries.map((query) => query.trim()).filter(Boolean),
          topicScope,
          input.pages,
        ),
        rerankQuery:
          object.canonicalQuestion?.trim() ||
          object.queries[0]?.trim() ||
          fallbackIntentForRerank(input.question),
        topicScope,
        method: "llm",
        rewriteModelId,
      };
    }
  } catch {
    // use fallback below
  }

  return fallbackRewrite(input.question, rewriteModelId, input.pages);
}
