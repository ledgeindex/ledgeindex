import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { askSource } from "@ledgeindex/docs/runtime/services/source-ask.js";
import { resolveSourceRefForUser } from "@ledgeindex/docs/runtime/services/source-resolve.js";
import { LOCAL_DESKTOP_USER_ID } from "../../lib/local-desktop-user.js";

const DEFAULT_SOURCE_ASK_GOOGLE_MODEL = "google/gemini-3.5-flash-lite";

export const queryKnowledgeSourceTool = createTool({
  id: "query_knowledge_source",
  description:
    "Answer a question using a specific indexed knowledge source. Pass source slug from list_knowledge_sources (preferred) or source UUID. Grounded in that source's pages and examples.",
  inputSchema: z.object({
    source: z
      .string()
      .min(1)
      .describe("Source slug (e.g. my-docs) or UUID."),
    question: z.string().min(1).describe("Question to answer from that source."),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    sourceId: z.string().optional(),
    sourceSlug: z.string().optional(),
    sourceName: z.string().optional(),
    answer: z.string().optional(),
    insufficient: z.boolean().optional(),
    chunkCount: z.number().optional(),
    mode: z.enum(["agent", "retrieve-only"]).optional(),
    message: z.string().optional(),
  }),
  execute: async ({ source, question }, context) => {
    const resolved = await resolveSourceRefForUser(
      source.trim(),
      LOCAL_DESKTOP_USER_ID,
    );
    if (!resolved) {
      return {
        ok: false,
        message: `Source not found: ${source}. Call list_knowledge_sources first.`,
      };
    }

    const ctx = context?.requestContext;
    const modelBackend = ctx?.get("model_backend");
    const modelId = ctx?.get("model_id");
    const baseUrl = ctx?.get("lm_studio_base_url");
    const googleModelId = ctx?.get("google_model_id");

    const result = await askSource(resolved.id, question.trim(), {
      model:
        typeof modelBackend === "string" && modelBackend.trim()
          ? {
              backend: modelBackend,
              ...(typeof modelId === "string" && modelId.trim()
                ? { modelId: modelId.trim() }
                : {}),
              ...(typeof baseUrl === "string" && baseUrl.trim()
                ? { baseUrl: baseUrl.trim() }
                : {}),
              ...(typeof googleModelId === "string" && googleModelId.trim()
                ? { googleModelId: googleModelId.trim() }
                : modelBackend === "api"
                  ? { googleModelId: DEFAULT_SOURCE_ASK_GOOGLE_MODEL }
                  : {}),
            }
          : {
              backend: "api",
              googleModelId: DEFAULT_SOURCE_ASK_GOOGLE_MODEL,
            },
    });
    return {
      ok: true,
      sourceId: resolved.id,
      sourceSlug: resolved.slug,
      sourceName: resolved.name,
      answer: result.answer,
      insufficient: result.insufficient,
      chunkCount: result.chunks.length,
      mode: result.mode,
    };
  },
});
