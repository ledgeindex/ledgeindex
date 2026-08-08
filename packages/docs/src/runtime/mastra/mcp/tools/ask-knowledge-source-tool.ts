import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { askSource } from "../../../services/source-ask.js";
import { resolveSourceRefForUser } from "../../../services/source-resolve.js";
import { mergeRequestContextFromMcp } from "../request-context-utils.js";
import {
  getRemotePlatformApiBase,
  readAuthTokenFromContext,
  remoteAskSource,
  remoteResolveGlobalSource,
} from "../remote-platform-api.js";

const hitSchema = z.object({
  text: z.string().describe("Matched chunk text."),
  url: z
    .string()
    .describe("Page URL this chunk came from (the document source URL)."),
  title: z
    .string()
    .describe("Page/document title when indexed; empty string if unknown."),
  score: z.number().describe("Relevance score after rerank."),
  section: z.string().optional().describe("Section path within the page, if any."),
  sourceId: z.string().describe("Knowledge source id."),
  sourceSlug: z.string().describe("Knowledge source slug."),
  sourceName: z
    .string()
    .describe("Knowledge source display name (the indexed corpus)."),
});

export const askKnowledgeSourceTool = createTool({
  id: "ask_source",
  description:
    "Retrieve grounded evidence from a source for a question. Runs vector search + rerank, then returns only chunks that clear the relevance threshold (no answer agent). Pass source slug (preferred) or UUID. Each hit includes the page url + page title (when available), plus sourceName for the knowledge source. Use the hits yourself to reason — count varies with how many chunks are relevant.",
  inputSchema: z.object({
    source: z
      .string()
      .min(1)
      .describe("Source slug (e.g. mastra) or UUID."),
    question: z.string().min(1).describe("Question to retrieve evidence for."),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    sourceId: z.string().optional(),
    sourceSlug: z.string().optional(),
    sourceName: z.string().optional(),
    insufficient: z.boolean().optional(),
    hitCount: z.number().optional(),
    hits: z.array(hitSchema).optional(),
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

    const local = await resolveSourceRefForUser(input.source, userId);
    if (local) {
      const result = await askSource(local.id, input.question, {
        mode: "retrieve-only",
      });

      const sourceMeta = {
        sourceId: local.id,
        sourceSlug: local.slug,
        sourceName: local.name,
      };

      return {
        ok: true,
        ...sourceMeta,
        insufficient: result.insufficient,
        hitCount: result.chunks.length,
        hits: result.chunks.map((chunk) => ({
          text: chunk.text,
          url: chunk.url,
          title: chunk.title || "",
          score: chunk.score,
          ...(chunk.section ? { section: chunk.section } : {}),
          ...sourceMeta,
        })),
        message: result.insufficient
          ? "No chunks cleared the relevance threshold. Try rephrasing or a different source."
          : undefined,
      };
    }

    const remoteBase = getRemotePlatformApiBase();
    if (!remoteBase) {
      return {
        ok: false,
        message: `Source not found or not accessible: ${input.source}`,
      };
    }

    const token = readAuthTokenFromContext(requestContext);
    if (!token) {
      return {
        ok: false,
        message:
          "Sign in required to query remote platform sources (Firebase token missing).",
      };
    }

    const remoteSource = await remoteResolveGlobalSource(token, input.source);
    if (!remoteSource) {
      return {
        ok: false,
        message: `Source not found or not accessible: ${input.source}`,
      };
    }

    const remote = await remoteAskSource(
      token,
      remoteSource.id,
      input.question,
    );
    if (!remote.ok) {
      return { ok: false, message: remote.message };
    }

    const chunks = Array.isArray(remote.result.chunks)
      ? remote.result.chunks
      : [];
    const insufficient =
      remote.result.insufficient !== undefined
        ? Boolean(remote.result.insufficient)
        : chunks.length === 0;
    const sourceMeta = {
      sourceId: remoteSource.id,
      sourceSlug: remoteSource.slug,
      sourceName: remoteSource.name,
    };

    return {
      ok: true,
      ...sourceMeta,
      insufficient,
      hitCount: chunks.length,
      hits: chunks.map((chunk) => ({
        text: String(chunk.text ?? ""),
        url: String(chunk.url ?? ""),
        title: String(chunk.title ?? ""),
        score: Number(chunk.score ?? 0),
        ...(chunk.section ? { section: String(chunk.section) } : {}),
        ...sourceMeta,
      })),
      message: insufficient
        ? "No chunks cleared the relevance threshold. Try rephrasing or a different source."
        : undefined,
    };
  },
});
