import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { listSourceSetSummaries } from "../../../services/source-set-summary.js";
import { ensureDefaultSourceSetForLimitedUser } from "../../../services/source-set-limits.js";
import { mergeRequestContextFromMcp } from "../request-context-utils.js";

export const listSourceSetsTool = createTool({
  id: "list_source_sets",
  description:
    "List source sets configured by the user. Each set groups multiple knowledge sources with slugs and ids. Use get_source_set before choosing which source to query.",
  inputSchema: z.object({
    query: z
      .string()
      .optional()
      .describe("Optional case-insensitive filter on set name or slug."),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    items: z.array(
      z.object({
        id: z.string(),
        slug: z.string(),
        name: z.string(),
        description: z.string().nullable(),
        sourceCount: z.number(),
      }),
    ),
    message: z.string().optional(),
  }),
  execute: async (input, context) => {
    const requestContext = mergeRequestContextFromMcp(context?.requestContext);
    const userId = String(
      requestContext.get("user_id") ?? requestContext.get("userId") ?? "",
    ).trim();
    if (!userId) {
      return { ok: false, items: [], message: "Authenticate MCP first" };
    }

    const q = String(input.query ?? "")
      .trim()
      .toLowerCase();
    await ensureDefaultSourceSetForLimitedUser(userId);
    let items = await listSourceSetSummaries(userId);
    if (q) {
      items = items.filter(
        (set) =>
          set.name.toLowerCase().includes(q) ||
          set.slug.toLowerCase().includes(q),
      );
    }

    return {
      ok: true,
      items: items.map((set) => ({
        id: set.id,
        slug: set.slug,
        name: set.name,
        description: set.description,
        sourceCount: set.sourceCount,
      })),
      message:
        items.length === 0
          ? "No source sets yet. Create one in the LedgeIndex UI."
          : undefined,
    };
  },
});
