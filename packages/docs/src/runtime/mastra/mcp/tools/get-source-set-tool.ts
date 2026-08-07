import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getStore } from "../../../db/index.js";
import { getSourceSetSummary } from "../../../services/source-set-summary.js";
import { mergeRequestContextFromMcp } from "../request-context-utils.js";

export const getSourceSetTool = createTool({
  id: "get_source_set",
  description:
    "Get a source set by slug or id, including member sources (id, slug, name, scope). Use this to decide which source to call with ask_source.",
  inputSchema: z.object({
    source_set: z
      .string()
      .min(1)
      .describe("Source set slug or UUID."),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    sourceSet: z
      .object({
        id: z.string(),
        slug: z.string(),
        name: z.string(),
        description: z.string().nullable(),
        sourceCount: z.number(),
        sources: z.array(
          z.object({
            id: z.string(),
            slug: z.string(),
            name: z.string(),
            scope: z.enum(["personal", "global"]),
          }),
        ),
      })
      .optional(),
    message: z.string().optional(),
  }),
  execute: async (input, context) => {
    const requestContext = mergeRequestContextFromMcp(context?.requestContext);
    const userId = String(
      requestContext.get("user_id") ?? requestContext.get("userId") ?? "",
    ).trim();
    if (!userId) {
      return { ok: false, message: "Authenticate MCP first" };
    }

    const ref = input.source_set.trim();
    const sourceSet =
      (await getStore().getSourceSet(ref)) ??
      (await getStore().getSourceSetBySlug(userId, ref));
    if (!sourceSet || sourceSet.ownerUserId !== userId) {
      return {
        ok: false,
        message: `Source set not found: ${ref}`,
      };
    }

    const summary = await getSourceSetSummary(sourceSet, userId);
    return { ok: true, sourceSet: summary };
  },
});
