import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import { cleanQuestionForRetrieve } from "@ledgeindex/core/query/query-intent.js";
import {
  primaryAuxiliaryModelId,
  resolveRewriteModelConfig,
} from "../llm/chat-model-config.js";
import { agentStructuredOutput } from "../llm/agent-structured-output.js";

const rewriteOutputSchema = z.object({
  topicScope: z.enum(["single", "multi"]),
  /** Natural-language search queries (embedding + BM25 use the same text). */
  queries: z.array(z.string().min(3).max(120)).min(1).max(3),
});

export type RewriteTopicScope = "single" | "multi";

/** Deterministic rewrite — topicScope and query variants should not flicker per run. */
const REWRITE_TEMPERATURE = 0;

export type RewriteResult = {
  /** Generated NL variants; the retrieve path always also includes the user question. */
  queries: string[];
  topicScope: RewriteTopicScope;
  method: "llm" | "fallback";
  rewriteModelId: string;
};

function fallbackRewrite(question: string, rewriteModelId: string): RewriteResult {
  const cleaned = cleanQuestionForRetrieve(question);
  return {
    queries: cleaned ? [cleaned] : [question.trim().slice(0, 120)],
    topicScope: "single",
    method: "fallback",
    rewriteModelId,
  };
}

export async function rewriteQueries(input: {
  question: string;
  catalogText: string;
  history: string;
  requestContext?: { get?: (key: string) => unknown };
}): Promise<RewriteResult> {
  const model = resolveRewriteModelConfig(input.requestContext);
  const rewriteModelId = primaryAuxiliaryModelId(input.requestContext);

  const agent = new Agent({
    id: "query-rewrite-agent",
    name: "Query Rewrite Agent",
    instructions: `Generate natural-language search queries for documentation retrieval (LlamaIndex-style query generation).

Decide topicScope first:
- "single": ONE documentation area. Multiple clauses about the same area → 1–2 query variants.
  Example: "How do I configure auth and session expiry?" → same auth area, one or two phrasings.
- "multi": DISTINCT documentation areas → one query per area (max 3), ordered by importance.
  Example: "What is billing and how do I set up webhooks?" → separate queries when catalog shows different sections.

Use vocabulary from the page catalog. Resolve follow-ups from conversation history.

Output:
1. topicScope — "single" or "multi".
2. queries — 1–3 complete natural-language questions or short phrases suitable for BOTH vector search and keyword search.
   - Use catalog terminology; prefer how the docs phrase the topic.
   - Do NOT output keyword lists, coreGoal splits, or code dumps.
   - Do NOT repeat the user's exact wording if a catalog phrase is clearer.
   - For vague questions ("what are the primitives"), name the product concepts from the catalog.

The retrieve pipeline always runs the user's original question as well; your queries are additional variants fused with RRF.`,
    model,
  });

  try {
    const object = await agentStructuredOutput(
      agent,
      `Catalog of indexed pages:\n${input.catalogText}\n\nConversation:\n${input.history}\n\nQuestion: ${input.question}`,
      rewriteOutputSchema,
      { temperature: REWRITE_TEMPERATURE },
    );
    if (object && object.queries.length > 0) {
      const queries = object.queries
        .map((query) => query.trim())
        .filter(Boolean)
        .slice(0, 3);
      return {
        queries,
        topicScope: object.topicScope === "multi" ? "multi" : "single",
        method: "llm",
        rewriteModelId,
      };
    }
  } catch {
    // use fallback below
  }

  return fallbackRewrite(input.question, rewriteModelId);
}
