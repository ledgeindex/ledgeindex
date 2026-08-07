import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { listSourceSummariesForOwner } from "../../../services/source-summary.js";
import { mergeRequestContextFromMcp } from "../request-context-utils.js";

export const listPersonalSourcesTool = createTool({
  id: "list_personal_sources",
  description:
    "List knowledge sources owned by the authenticated user. Returns id, slug, name, scope, and indexing stats. Use slug (e.g. mastra) instead of UUID when calling ask_source.",
  inputSchema: z.object({
    query: z
      .string()
      .optional()
      .describe("Optional case-insensitive filter on source name or slug."),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    items: z.array(
      z.object({
        id: z.string(),
        slug: z.string(),
        name: z.string(),
        scope: z.enum(["personal", "global"]),
        startUrl: z.string(),
        pageCount: z.number(),
        chunkCount: z.number(),
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
      return {
        ok: false,
        items: [],
        message: "Authenticate MCP first",
      };
    }

    const q = String(input.query ?? "")
      .trim()
      .toLowerCase();
    let items = await listSourceSummariesForOwner(userId);
    if (q) {
      items = items.filter(
        (source) =>
          source.name.toLowerCase().includes(q) ||
          source.slug.toLowerCase().includes(q),
      );
    }

    return {
      ok: true,
      items: items.map((source) => ({
        id: source.id,
        slug: source.slug,
        name: source.name,
        scope: source.scope,
        startUrl: source.startUrl,
        pageCount: source.pageCount,
        chunkCount: source.chunkCount,
      })),
      message:
        items.length === 0
          ? "No personal sources found. Index a web crawl in LedgeIndex first."
          : undefined,
    };
  },
});
