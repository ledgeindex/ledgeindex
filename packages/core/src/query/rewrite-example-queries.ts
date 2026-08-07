// @ts-nocheck
import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import { exampleKindSchema } from "../enrich/schemas.js";
import { getRewriteModel } from "../llm/models.js";

const rewriteExampleOutputSchema = z.object({
  queries: z.array(z.string().min(2).max(100)).min(1).max(3),
  exampleKind: exampleKindSchema.nullable().optional(),
  language: z.string().nullable().optional(),
});

export type RewriteExampleQueriesResult = {
  queries: string[];
  exampleKind?: z.infer<typeof exampleKindSchema>;
  language?: string;
  method: "llm" | "fallback";
};

const INSTRUCTIONS = `Rewrite user questions into short search queries for a documentation EXAMPLE vector index.

The index stores setup/code/usage/config/api_response examples with embed text like:
"Page: … | Section: … | Kind: code | Language: ts | Topic: … | Example:\\n…"

Rules:
- Use vocabulary from the example catalog (kinds, languages, titles, sections).
- Emit 1–3 short keyword queries (3–8 words), not chatty questions.
- Prefer concrete intents: "create agent with tools typescript", "install dependencies npm", "403 forbidden error code".
- If the user clearly wants code/setup/usage/config/api_response, set exampleKind.
- If they name a language (TypeScript, Python, …), set language to a short id (ts, python, …).
- If unsure about kind/language, leave them null.
- Do not invent catalog entries that are not listed.`;

function fallbackQueries(question: string): string[] {
  const cleaned = question
    .replace(/[?!.,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return [cleaned.slice(0, 80) || question.slice(0, 80)];
}

export async function rewriteExampleQueries(input: {
  question: string;
  catalogText: string;
  history?: string;
}): Promise<RewriteExampleQueriesResult> {
  const question = input.question.trim();
  if (!question) {
    return { queries: ["examples"], method: "fallback" };
  }

  const model = getRewriteModel();
  const agent = new Agent({
    id: "example-query-rewrite-agent",
    name: "Example Query Rewrite",
    instructions: INSTRUCTIONS,
    model,
  });

  const prompt = [
    "Example catalog (kind | language | section | title):",
    input.catalogText,
    "",
    input.history?.trim()
      ? `Conversation:\n${input.history.trim()}\n`
      : null,
    `Question: ${question}`,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const result = await agent.generate(prompt, {
      maxSteps: 1,
      structuredOutput: {
        schema: rewriteExampleOutputSchema,
        jsonPromptInjection: "auto",
      },
    });
    const parsed = rewriteExampleOutputSchema.safeParse(result.object);
    if (parsed.success && parsed.data.queries.length > 0) {
      const language =
        typeof parsed.data.language === "string" &&
        parsed.data.language.trim().length > 0
          ? parsed.data.language.trim().toLowerCase()
          : undefined;
      return {
        queries: parsed.data.queries.slice(0, 3),
        ...(parsed.data.exampleKind
          ? { exampleKind: parsed.data.exampleKind }
          : {}),
        ...(language ? { language } : {}),
        method: "llm",
      };
    }
  } catch {
    // fallback below
  }

  return {
    queries: fallbackQueries(question),
    method: "fallback",
  };
}
