import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { listSourceSummariesForOwner } from "@ledgeindex/docs/runtime/services/source-summary.js";
import { AG_BRAIN_LEDGEINDEX_SOURCE_SLUG } from "../../brain-source.js";
import { LOCAL_DESKTOP_USER_ID } from "../../lib/local-desktop-user.js";

const sourceItemSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  kind: z.enum(["brain_notes", "documentation"]),
  startUrl: z.string(),
  pageCount: z.number(),
  chunkCount: z.number(),
  indexedAt: z.string().nullable(),
});

export const listKnowledgeSourcesTool = createTool({
  id: "list_knowledge_sources",
  description:
    "List indexed knowledge sources in AutomationGhost (documentation crawls and the Brain notes index). Returns slug, name, and stats — use slug with query_knowledge_source.",
  inputSchema: z.object({
    query: z
      .string()
      .optional()
      .describe("Optional filter on source name or slug (case-insensitive)."),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    items: z.array(sourceItemSchema),
    message: z.string().optional(),
  }),
  execute: async ({ query }) => {
    const q = String(query ?? "")
      .trim()
      .toLowerCase();
    let items = await listSourceSummariesForOwner(LOCAL_DESKTOP_USER_ID);
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
        kind:
          source.slug === AG_BRAIN_LEDGEINDEX_SOURCE_SLUG
            ? ("brain_notes" as const)
            : ("documentation" as const),
        startUrl: source.startUrl,
        pageCount: source.pageCount,
        chunkCount: source.chunkCount,
        indexedAt: source.indexedAt,
      })),
      message:
        items.length === 0
          ? "No indexed sources yet. Add documentation in Brain or index notes."
          : undefined,
    };
  },
});
