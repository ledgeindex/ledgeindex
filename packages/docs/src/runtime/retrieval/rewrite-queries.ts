import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import {
  primaryAuxiliaryModelId,
  resolveRewriteModelConfig,
} from "../llm/chat-model-config.js";
import { agentStructuredOutput } from "../llm/agent-structured-output.js";

const rewriteOutputSchema = z.object({
  /** "single" = one topic area (1 query). "multi" = distinct areas (1 query each, max 3). */
  topicScope: z.enum(["single", "multi"]),
  queries: z.array(z.string().min(3).max(80)).min(1).max(3),
});

export type RewriteTopicScope = "single" | "multi";

export type RewriteResult = {
  queries: string[];
  topicScope: RewriteTopicScope;
  method: "llm" | "fallback";
  rewriteModelId: string;
};

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
    instructions: `Rewrite documentation questions into search queries for vector retrieval.

Decide topicScope first:
- "single": ONE documentation area. Multiple clauses about the same area → 1 query.
  Example: "How do I configure auth and session expiry?" → one query (same auth area).
  Example: "How do I pass data between pipeline steps?" → one query (same pipeline area).
- "multi": DISTINCT documentation areas → 1 query per area (max 3), ordered by importance.
  Example: "What is billing and how do I set up webhooks?" → separate queries when catalog shows different sections.
  Example: "What are workspaces and how do I pass data between workflow steps?" → separate queries when those topics map to different catalog pages.

Do NOT merge unrelated areas into one vague query just because words appear together in the question. Use the page catalog to decide whether clauses belong to the same section or different sections.

Rules:
- Use vocabulary from the page catalog. Resolve follow-ups from conversation history.
- Keep queries short (3-8 words), keyword-rich, no URL paths.
- Compound questions ("and"/"und") can be single or multi — decide by doc area, not by keyword overlap.`,
    model,
  });

  try {
    const object = await agentStructuredOutput(
      agent,
      `Catalog of indexed pages:\n${input.catalogText}\n\nConversation:\n${input.history}\n\nQuestion: ${input.question}`,
      rewriteOutputSchema,
    );
    if (object && object.queries.length > 0) {
      const queries = object.queries.slice(0, 3);
      const topicScope = object.topicScope;
      return {
        queries,
        topicScope: topicScope === "multi" ? "multi" : "single",
        method: "llm",
        rewriteModelId,
      };
    }
  } catch {
    // use raw question below
  }

  return {
    queries: [input.question],
    topicScope: "single",
    method: "fallback",
    rewriteModelId,
  };
}
