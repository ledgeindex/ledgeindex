import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { listGlobalSourceSummaries } from "../../../services/source-summary.js";
import { mergeRequestContextFromMcp } from "../request-context-utils.js";
import {
  getRemotePlatformApiBase,
  readAuthTokenFromContext,
  remoteListGlobalSources,
} from "../remote-platform-api.js";

export const listPlatformSourcesTool = createTool({
  id: "list_platform_sources",
  description:
    "List platform-wide (global) knowledge sources available to all users. Returns id, slug, name, scope, and indexing stats. Use slug when calling ask_source.",
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

    const remoteBase = getRemotePlatformApiBase();
    if (remoteBase) {
      const token = readAuthTokenFromContext(requestContext);
      if (!token) {
        return {
          ok: false,
          items: [],
          message:
            "Sign in required to list remote platform sources (Firebase token missing).",
        };
      }

      const remote = await remoteListGlobalSources(token);
      if (!remote.ok) {
        return { ok: false, items: [], message: remote.message };
      }

      let items = remote.items;
      if (q) {
        items = items.filter(
          (source) =>
            source.name.toLowerCase().includes(q) ||
            source.slug.toLowerCase().includes(q),
        );
      }

      return {
        ok: true,
        items,
        message:
          items.length === 0
            ? "No platform sources found yet."
            : undefined,
      };
    }

    let items = await listGlobalSourceSummaries();
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
          ? "No platform sources found yet."
          : undefined,
    };
  },
});
