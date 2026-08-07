import type { Processor, ProcessInputArgs } from "@mastra/core/processors";
import type { MastraDBMessage } from "@mastra/core/agent";
import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import type { KapaRetrievedChunk } from "../../retrieval/kapa-retrieve.js";
import { kapaRetrieveMany } from "../../retrieval/kapa-retrieve.js";
import {
  LEDGEINDEX_RETRIEVAL_META_KEY,
  toRetrievalMetaChunk,
  type RetrievalMeta,
} from "../../retrieval/retrieval-meta.js";
import {
  assessCoverage,
  instructionForAnswerMode,
} from "../../retrieval/assess-coverage.js";
import { rewriteQueries } from "../../retrieval/rewrite-queries.js";
import { ensureCatalogHasPages } from "../../retrieval/page-catalog-rebuild.js";
import { getMetadataCatalog } from "../../retrieval/metadata-catalog-store.js";
import { formatCatalogForAgent } from "../../retrieval/search-query-planner.js";
import type { MetadataCatalog } from "../../retrieval/metadata-catalog.js";
import { agentStructuredOutput } from "../../llm/agent-structured-output.js";
import {
  primaryAuxiliaryModelId,
  resolveRewriteModelConfig,
} from "../../llm/chat-model-config.js";
import { listGlobalSourceSummaries, listSourceSummariesForOwner } from "../../services/source-summary.js";
import { logVerbose, logWarn } from "../../lib/logger.js";
import {
  getRemotePlatformApiBase,
  remoteAskSource,
  remoteGetMetadataCatalog,
  remoteListGlobalSources,
  type RemotePlatformSourceSummary,
} from "../mcp/remote-platform-api.js";
import { RELAXED_RELEVANCE_THRESHOLD } from "../../vector/constants.js";
import {
  getRequestRerankBackend,
  runWithRetrievalContext,
} from "../../retrieval/rerank-request-context.js";
import {
  resolveExploreIntentRouterMode,
  routeExploreIntentWaterfall,
} from "../../retrieval/explore-intent-classifier.js";
import { tryCascadeRetrieve } from "../../retrieval/cascade-retrieve.js";
import { describeRerankRuntimeMeta } from "../../retrieval/rerank-backend.js";

const MAX_PICKED_SOURCES = 3;
const MAX_HISTORY_TURNS = 6;

type ExploreSource = {
  id: string;
  slug: string;
  name: string;
  scope: "personal" | "global";
  hosting: "local" | "cloud";
  /** True only when this source came from LEDGEINDEX_REMOTE_API_URL (needs Bearer). */
  remote: boolean;
  pageCount: number;
  chunkCount: number;
  faviconUrl?: string | null;
  startUrl?: string | null;
};

type ExploreIntent = "chat" | "list_sources" | "retrieve";

const routerSchema = z.object({
  intent: z.enum(["chat", "list_sources", "retrieve"]),
  reason: z.string().min(1).max(240),
});

const pickerSchema = z.object({
  slugs: z
    .array(z.string().min(1))
    .min(1)
    .max(MAX_PICKED_SOURCES)
    .describe("Up to 3 global source slugs to retrieve from."),
});

function textFromMessage(message: MastraDBMessage): string {
  const parts = message.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .map((part) =>
      part && typeof part === "object" && "text" in part
        ? String((part as { text?: unknown }).text ?? "")
        : "",
    )
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildHistory(messages: MastraDBMessage[]): string {
  const turns = messages
    .slice(0, -1)
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-MAX_HISTORY_TURNS)
    .map((m) => {
      const text = textFromMessage(m);
      if (!text) return "";
      const clipped = text.length > 300 ? `${text.slice(0, 300)}…` : text;
      return `${m.role}: ${clipped}`;
    })
    .filter(Boolean);

  return turns.length > 0 ? turns.join("\n") : "(no prior messages)";
}

function readAuthToken(requestContext: ProcessInputArgs["requestContext"]): string {
  if (typeof requestContext?.get !== "function") return "";
  const token = requestContext.get("auth_token");
  return typeof token === "string" ? token.trim() : "";
}

function readUserId(requestContext: ProcessInputArgs["requestContext"]): string {
  if (typeof requestContext?.get !== "function") return "";
  const raw =
    requestContext.get("user_id") ?? requestContext.get("userId") ?? "";
  return typeof raw === "string" ? raw.trim() : "";
}

/** Desktop sidecar: also include the local owner id used when auth is optional. */
function personalOwnerIds(primaryUserId: string): string[] {
  const ids = new Set<string>();
  if (primaryUserId) ids.add(primaryUserId);
  if (process.env.LEDGEINDEX_AUTH_REQUIRED !== "1") {
    ids.add(
      process.env.LEDGEINDEX_LOCAL_USER_ID?.trim() || "ledgeindex-desktop-local",
    );
  }
  return [...ids];
}

function formatCatalog(sources: ExploreSource[]): string {
  if (sources.length === 0) return "(no sources indexed)";
  return sources
    .map((source) => {
      const origin = source.remote ? "remote" : "local";
      return `- ${source.name} (slug: ${source.slug}, scope: ${source.scope}, origin: ${origin}, pages: ${source.pageCount}, chunks: ${source.chunkCount})`;
    })
    .join("\n");
}

function formatChunksForContext(chunks: KapaRetrievedChunk[]): string {
  return chunks
    .map((chunk, index) => {
      const heading =
        chunk.section.trim() || chunk.category.trim() || chunk.title.trim();
      return `### Source ${index + 1}: ${chunk.title}
URL: ${chunk.url}
Corpus: ${chunk.category || "global"}
Section: ${heading}
Score: ${chunk.score.toFixed(2)}

${chunk.text}`;
    })
    .join("\n\n");
}

function scoreSummary(chunks: KapaRetrievedChunk[]): {
  maxChunkScore?: number;
  avgTop3Score?: number;
} {
  const scores = chunks
    .map((chunk) => chunk.score)
    .filter((score) => Number.isFinite(score))
    .sort((a, b) => b - a);
  if (scores.length === 0) return {};
  const top3 = scores.slice(0, 3);
  return {
    maxChunkScore: scores[0],
    avgTop3Score: top3.reduce((sum, score) => sum + score, 0) / top3.length,
  };
}

function hitToChunk(
  hit: {
    text: string;
    url: string;
    title: string;
    score: number;
    section?: string;
  },
  sourceName: string,
  index: number,
): KapaRetrievedChunk {
  return {
    id: `explore-${index}`,
    score: hit.score,
    text: hit.text,
    url: hit.url,
    title: hit.title || sourceName,
    category: sourceName,
    section: hit.section ?? "",
    headingPath: [],
    chunkIndex: index,
  };
}

function dedupeChunks(chunks: KapaRetrievedChunk[]): KapaRetrievedChunk[] {
  const seen = new Set<string>();
  const out: KapaRetrievedChunk[] = [];
  for (const chunk of chunks) {
    const key = `${chunk.url}::${chunk.text.slice(0, 120)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(chunk);
  }
  return out;
}

async function loadPersonalSources(
  userId: string,
): Promise<ExploreSource[]> {
  const ownerIds = personalOwnerIds(userId);
  if (ownerIds.length === 0) return [];

  const batches = await Promise.all(
    ownerIds.map((id) => listSourceSummariesForOwner(id)),
  );
  const seen = new Set<string>();
  const out: ExploreSource[] = [];
  for (const items of batches) {
    for (const item of items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push({
        id: item.id,
        slug: item.slug,
        name: item.name,
        scope: "personal",
        hosting: item.hosting === "cloud" ? "cloud" : "local",
        remote: false,
        pageCount: item.pageCount,
        chunkCount: item.chunkCount,
        faviconUrl: item.faviconUrl ?? null,
        startUrl: item.startUrl || null,
      });
    }
  }
  return out;
}

async function loadLocalGlobalSources(): Promise<ExploreSource[]> {
  const items = await listGlobalSourceSummaries();
  return items.map((item) => ({
    id: item.id,
    slug: item.slug,
    name: item.name,
    scope: "global" as const,
    hosting: "cloud" as const,
    remote: false,
    pageCount: item.pageCount,
    chunkCount: item.chunkCount,
    faviconUrl: item.faviconUrl ?? null,
    startUrl: item.startUrl || null,
  }));
}

/**
 * Platform/global catalog:
 * - With remote URL + Firebase Bearer → intentional remote pull
 * - Otherwise → local globals only (never call remote by accident)
 */
async function loadPlatformSources(
  authToken: string,
): Promise<{ sources: ExploreSource[]; error?: string }> {
  const remoteBase = getRemotePlatformApiBase();
  if (remoteBase && authToken) {
    const listed = await remoteListGlobalSources(authToken);
    if (!listed.ok) {
      // Keep local globals usable; surface remote failure as a soft note.
      const local = await loadLocalGlobalSources();
      return { sources: local, error: listed.message };
    }
    return {
      sources: listed.items.map((item: RemotePlatformSourceSummary) => ({
        id: item.id,
        slug: item.slug,
        name: item.name,
        scope: "global" as const,
        hosting: "cloud" as const,
        remote: true,
        pageCount: item.pageCount,
        chunkCount: item.chunkCount,
        faviconUrl: item.faviconUrl ?? null,
        startUrl: item.startUrl || null,
      })),
    };
  }

  return { sources: await loadLocalGlobalSources() };
}

/** Personal (always local) + platform (remote only with auth, else local). */
async function loadExploreSources(input: {
  authToken: string;
  userId: string;
}): Promise<{ sources: ExploreSource[]; platformError?: string }> {
  const [personal, platform] = await Promise.all([
    loadPersonalSources(input.userId),
    loadPlatformSources(input.authToken),
  ]);
  return {
    sources: [...personal, ...platform.sources],
    platformError: platform.error,
  };
}

function usesRemoteCorpus(source: ExploreSource): boolean {
  return source.remote;
}

/**
 * Personal local → FastEmbed + LibSQL (+ UI rerank).
 * Cloud-hosted (public or personal-on-cloud) → Gemini + pgvector + Cohere.
 * Must be set per picked source — Explore can mix both in one turn.
 */
function withSourceRetrievalContext<T>(
  source: ExploreSource,
  fn: () => Promise<T>,
): Promise<T> {
  const sourceScope = source.scope === "global" ? "global" : "personal";
  const sourceHosting =
    source.hosting === "cloud" || source.scope === "global" ? "cloud" : "local";
  return runWithRetrievalContext(
    {
      sourceScope,
      sourceHosting,
      backend:
        sourceHosting === "cloud" ? "cohere-auto" : getRequestRerankBackend(),
    },
    fn,
  );
}

async function loadSourceCatalogText(input: {
  source: ExploreSource;
  authToken: string;
}): Promise<string> {
  if (usesRemoteCorpus(input.source)) {
    if (!input.authToken) return "No catalog available.";
    const remote = await remoteGetMetadataCatalog(
      input.authToken,
      input.source.id,
    );
    if (!remote.ok) {
      logWarn(remote.message, "ExploreQuery", {
        sourceId: input.source.id,
        step: "catalog",
      });
      return "No catalog available.";
    }
    return formatCatalogForAgent(remote.catalog as MetadataCatalog | null);
  }

  const catalog =
    (await ensureCatalogHasPages(input.source.id)) ??
    (await getMetadataCatalog(input.source.id));
  return formatCatalogForAgent(catalog);
}

async function retrieveSourceHits(input: {
  source: ExploreSource;
  queries: string[];
  authToken: string;
}): Promise<{
  chunks: KapaRetrievedChunk[];
  insufficient: boolean;
  relaxedPassUsed: boolean;
  byQuery: Array<{ query: string; chunkCount: number; insufficient: boolean }>;
}> {
  const queries =
    input.queries.length > 0 ? input.queries.slice(0, 3) : ["documentation"];

  if (usesRemoteCorpus(input.source)) {
    const rerankBackend = getRequestRerankBackend();
    // Parallel retrieve-only asks per rewritten query against this source.
    const results = await Promise.all(
      queries.map(async (query) => {
        const remote = await remoteAskSource(
          input.authToken,
          input.source.id,
          query,
          rerankBackend ? { rerankBackend } : undefined,
        );
        if (!remote.ok) {
          logWarn(remote.message, "ExploreQuery", {
            sourceId: input.source.id,
            query,
          });
          return {
            query,
            chunks: [] as KapaRetrievedChunk[],
            insufficient: true,
          };
        }
        const hits = Array.isArray(remote.result.chunks)
          ? remote.result.chunks
          : [];
        const insufficient =
          remote.result.insufficient !== undefined
            ? Boolean(remote.result.insufficient)
            : hits.length === 0;
        return {
          query,
          insufficient,
          chunks: hits.map((hit, index) =>
            hitToChunk(hit, input.source.name, index),
          ),
        };
      }),
    );

    const chunks = dedupeChunks(results.flatMap((entry) => entry.chunks));
    return {
      chunks,
      insufficient: chunks.length === 0,
      // Remote ask does not yet expose whether its internal relaxed pass ran.
      relaxedPassUsed: false,
      byQuery: results.map((entry) => ({
        query: entry.query,
        chunkCount: entry.chunks.length,
        insufficient: entry.insufficient,
      })),
    };
  }

  return withSourceRetrievalContext(input.source, async () => {
    let relaxedPassUsed = false;
    let retrieval = await kapaRetrieveMany({
      queries,
      sourceId: input.source.id,
      queryMode: queries.length > 1 ? "merge_all" : "short_circuit",
    });

    if (retrieval.merged.length === 0) {
      retrieval = await kapaRetrieveMany({
        queries,
        sourceId: input.source.id,
        queryMode: queries.length > 1 ? "merge_all" : "short_circuit",
        relevanceThreshold: RELAXED_RELEVANCE_THRESHOLD,
      });
      relaxedPassUsed = retrieval.merged.length > 0;
    }

    const chunks = retrieval.merged.map((chunk, index) => ({
      ...chunk,
      id: chunk.id || `explore-${input.source.slug}-${index}`,
      category: chunk.category || input.source.name,
    }));

    return {
      chunks,
      insufficient: chunks.length === 0,
      relaxedPassUsed,
      byQuery: retrieval.byQuery.map((entry) => ({
        query: entry.query,
        chunkCount: entry.rawPrunedCount ?? entry.prunedCount ?? 0,
        insufficient: entry.insufficient,
      })),
    };
  });
}

async function routeExploreIntentWithLlm(input: {
  question: string;
  history: string;
  catalogText: string;
}): Promise<{ intent: ExploreIntent; reason: string } | null> {
  const agent = new Agent({
    id: "explore-router-agent",
    name: "Explore Router",
    instructions: `You route Explore chat turns for a knowledge-base product (personal + global sources).

intents:
- "chat": greetings, thanks, acknowledgements ("cool", "nice", "ok", "thanks"), opinions, meta chat about the product, or anything that does not need the knowledge corpus. History about a technical topic does NOT make a short reaction into "retrieve".
- "list_sources": user wants to know which sources exist / browse the catalog
- "retrieve": user asks a factual/howto question (or a clear follow-up question) that should be answered from indexed docs

Rules:
- Prefer "chat" for reactions, confirmations, and small talk — even after a docs Q&A.
- Prefer "retrieve" only when the latest user message itself asks for information from sources (including short follow-ups like "how?", "why?", "and for React?", "show an example").
- Prefer "list_sources" when they ask what sources/sets/indexes are available.
- When unsure whether they want more docs evidence, prefer "chat" unless the message is clearly a question.`,
    model: resolveRewriteModelConfig(),
  });

  try {
    const object = await agentStructuredOutput(
      agent,
      [
        `Latest user message: ${input.question}`,
        "",
        "Recent history (context only — route the latest message, not the history):",
        input.history,
        "",
        "Available sources:",
        input.catalogText,
      ].join("\n"),
      routerSchema,
    );
    if (object) {
      return { intent: object.intent, reason: object.reason };
    }
  } catch (error) {
    logWarn(
      error instanceof Error ? error.message : "Explore router failed",
      "ExploreQuery",
    );
  }
  return null;
}

async function routeExploreIntent(input: {
  question: string;
  history: string;
  catalogText: string;
}): Promise<{ intent: ExploreIntent; reason: string }> {
  const mode = resolveExploreIntentRouterMode();

  // Waterfall: regex → DistilBERT → (null = LLM below).
  if (mode === "local" || mode === "auto") {
    const local = await routeExploreIntentWaterfall({
      question: input.question,
      history: input.history,
      mode,
    });
    if (local) {
      logVerbose("Explore intent waterfall", "ExploreQuery", {
        mode,
        source: local.source,
        label: local.label,
        pipelineIntent: local.pipelineIntent,
        score: local.score,
      });
      return {
        intent: local.pipelineIntent,
        reason: local.reason,
      };
    }
  }

  if (mode === "llm" || mode === "auto") {
    const llm = await routeExploreIntentWithLlm(input);
    if (llm) return llm;
  }

  return {
    intent: "retrieve",
    reason: "Router unavailable; defaulting to retrieve.",
  };
}

async function pickSources(input: {
  question: string;
  history: string;
  sources: ExploreSource[];
}): Promise<string[]> {
  if (input.sources.length === 0) return [];
  if (input.sources.length === 1) return [input.sources[0]!.slug];

  const agent = new Agent({
    id: "explore-source-picker-agent",
    name: "Explore Source Picker",
    instructions: `Pick up to ${MAX_PICKED_SOURCES} source slugs that are most likely to answer the user's question.
Only use slugs from the provided catalog (personal and/or global). Prefer fewer sources when one is clearly enough.`,
    model: resolveRewriteModelConfig(),
  });

  try {
    const object = await agentStructuredOutput(
      agent,
      [
        `Question: ${input.question}`,
        "",
        "Recent history:",
        input.history,
        "",
        "Catalog:",
        formatCatalog(input.sources),
      ].join("\n"),
      pickerSchema,
    );
    if (!object) return input.sources.slice(0, 1).map((s) => s.slug);

    const allowed = new Set(input.sources.map((s) => s.slug.toLowerCase()));
    const picked = object.slugs
      .map((slug) => slug.trim())
      .filter((slug) => allowed.has(slug.toLowerCase()))
      .slice(0, MAX_PICKED_SOURCES);

    if (picked.length > 0) return picked;
  } catch (error) {
    logWarn(
      error instanceof Error ? error.message : "Explore picker failed",
      "ExploreQuery",
    );
  }

  return input.sources.slice(0, 1).map((s) => s.slug);
}

function appendSystem(
  systemMessages: ProcessInputArgs["systemMessages"],
  content: string,
) {
  const trimmed = content.trim();
  if (!trimmed) return systemMessages ?? [];
  return [
    ...(systemMessages ?? []),
    {
      role: "system" as const,
      content: trimmed,
    },
  ];
}

/**
 * Controlled Explore pipeline (no free-form tools):
 * 1) route intent
 * 2) if retrieve — pick ≤3 sources (personal local + global/platform)
 * 3) per source in parallel: catalog → rewrite queries → retrieve
 * 4) assess full / partial / none coverage and inject answer instructions
 */
export class ExploreQueryProcessor implements Processor {
  readonly id = "explore-query";
  readonly name = "Explore Query";

  async processInput({
    messages,
    systemMessages,
    requestContext,
  }: ProcessInputArgs) {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const question = lastUser ? textFromMessage(lastUser) : "";
    if (!question) return messages;

    const authToken = readAuthToken(requestContext);
    const userId = readUserId(requestContext);
    const history = buildHistory(messages);
    const loaded = await loadExploreSources({ authToken, userId });
    const catalogText = formatCatalog(loaded.sources);

    // Remote global needs sign-in — but still continue if personal sources exist.
    if (
      loaded.platformError &&
      getRemotePlatformApiBase() &&
      loaded.sources.length === 0
    ) {
      return {
        messages,
        systemMessages: appendSystem(
          systemMessages,
          `${loaded.platformError}
Tell the user they need to sign in to explore remote global sources, or index a personal source locally first.`,
        ),
      };
    }

    const routed = await routeExploreIntent({
      question,
      history,
      catalogText,
    });

    logVerbose("Explore router decided", "ExploreQuery", {
      question,
      intent: routed.intent,
      reason: routed.reason,
      sourceCount: loaded.sources.length,
      personalCount: loaded.sources.filter((s) => s.scope === "personal").length,
      platformError: loaded.platformError,
      modelId: primaryAuxiliaryModelId(),
    });

    if (routed.intent === "chat") {
      return {
        messages,
        systemMessages: appendSystem(
          systemMessages,
          `The user does not need corpus retrieval for this turn.
Answer helpfully. If useful, mention they can ask about available sources (personal or global) or ask a docs question.`,
        ),
      };
    }

    if (loaded.sources.length === 0) {
      return {
        messages,
        systemMessages: appendSystem(
          systemMessages,
          `No knowledge sources are available yet.
Tell the user clearly that there are no personal or platform sources indexed.${
            loaded.platformError ? `\nAlso note: ${loaded.platformError}` : ""
          }`,
        ),
      };
    }

    if (routed.intent === "list_sources") {
      const platformNote = loaded.platformError
        ? `\n\nNote on global/platform sources: ${loaded.platformError}`
        : "";
      return {
        messages,
        systemMessages: appendSystem(
          systemMessages,
          `The user wants to know which sources are available.
List them clearly using this catalog (name + slug + scope). Do not invent sources.

Available sources:
${catalogText}${platformNote}`,
        ),
      };
    }

    const pickedSlugs = await pickSources({
      question,
      history,
      sources: loaded.sources,
    });
    const picked = pickedSlugs
      .map((slug) =>
        loaded.sources.find((s) => s.slug.toLowerCase() === slug.toLowerCase()),
      )
      .filter((s): s is ExploreSource => Boolean(s))
      .slice(0, MAX_PICKED_SOURCES);

    logVerbose("Explore sources picked", "ExploreQuery", {
      question,
      slugs: picked.map((s) => s.slug),
    });

    // Per picked source (in parallel): cascade peek on the raw question first;
    // only then catalog → rewrite → full retrieve when cascade misses.
    const perSource = await Promise.all(
      picked.map(async (source) => {
        if (!usesRemoteCorpus(source)) {
          const cascade = await withSourceRetrievalContext(source, () =>
            tryCascadeRetrieve({
              query: question,
              sourceId: source.id,
            }),
          );
          if (cascade) {
            const chunks = cascade.chunks.map((chunk, index) => ({
              ...chunk,
              id: chunk.id || `explore-cascade-${source.slug}-${index}`,
              category: chunk.category || source.name,
            }));
            return {
              source,
              rewrite: {
                queries: [question],
                topicScope: "single" as const,
                method: "cascade" as const,
                rewriteModelId: primaryAuxiliaryModelId(),
              },
              chunks,
              insufficient: chunks.length === 0,
              relaxedPassUsed: false,
              cascadePassUsed: true as const,
              cascadeTopScore: cascade.topScore as number | undefined,
              byQuery: [
                {
                  query: question,
                  chunkCount: chunks.length,
                  insufficient: chunks.length === 0,
                },
              ],
            };
          }
        }

        const catalogText = await loadSourceCatalogText({ source, authToken });
        const rewrite = await rewriteQueries({
          question,
          catalogText,
          history,
          requestContext,
        });
        const result = await retrieveSourceHits({
          source,
          queries: rewrite.queries,
          authToken,
        });
        return {
          source,
          rewrite,
          ...result,
          cascadePassUsed: false as const,
          cascadeTopScore: undefined as number | undefined,
        };
      }),
    );

    const merged = dedupeChunks(
      perSource.flatMap((entry) => entry.chunks),
    ).sort((a, b) => b.score - a.score);
    const agentChunks = merged.slice(0, 24);
    const insufficient = agentChunks.length === 0;
    const relaxedPassUsed = perSource.some((entry) => entry.relaxedPassUsed);
    const cascadePassUsed = perSource.some((entry) => entry.cascadePassUsed);
    const cascadeTopScore = perSource
      .map((entry) => entry.cascadeTopScore)
      .filter((score): score is number => typeof score === "number")
      .sort((a, b) => b - a)[0];
    const { maxChunkScore, avgTop3Score } = scoreSummary(agentChunks);
    const coverage = await assessCoverage({
      question,
      chunks: agentChunks,
      insufficient,
      relaxedPassUsed,
      maxChunkScore,
      avgTop3Score,
      requestContext,
    });

    const rewrittenQueries = [
      ...new Set(perSource.flatMap((entry) => entry.rewrite.queries)),
    ];
    const rewriteMethod = cascadePassUsed
      ? ("cascade" as const)
      : perSource.some((entry) => entry.rewrite.method === "llm")
        ? ("llm" as const)
        : ("fallback" as const);
    const anyMulti = perSource.some(
      (entry) => entry.rewrite.topicScope === "multi",
    );
    const rewriteModelId =
      perSource[0]?.rewrite.rewriteModelId ?? primaryAuxiliaryModelId();

    const rerankRuntime = describeRerankRuntimeMeta({ cascadePassUsed });

    const meta: RetrievalMeta = {
      question,
      rewrittenQueries:
        rewrittenQueries.length > 0 ? rewrittenQueries : [question],
      rewriteMethod,
      rewriteModelId,
      topicScope:
        picked.length > 1 || anyMulti ? "multi" : "single",
      insufficient,
      partial: coverage.answerMode === "partial" || relaxedPassUsed,
      relaxedPassUsed,
      cascadePassUsed,
      cascadeTopScore,
      rerankBackend: rerankRuntime.rerankBackend,
      rerankDevice: rerankRuntime.rerankDevice,
      rerankDeviceLabel: rerankRuntime.rerankDeviceLabel,
      maxChunkScore,
      avgTop3Score,
      answerMode: coverage.answerMode,
      coverageTier: coverage.coverageTier,
      coverageGraderUsed: coverage.coverageGraderUsed,
      coverageReason: coverage.coverageReason,
      coverageModelId: coverage.coverageModelId,
      pickedSources: picked.map((source) => ({
        id: source.id,
        slug: source.slug,
        name: source.name,
        faviconUrl: source.faviconUrl ?? null,
        startUrl: source.startUrl ?? null,
        scope: source.scope,
        remote: source.remote,
      })),
      searchAttempts: perSource.flatMap((entry) =>
        entry.byQuery.map((attempt) => ({
          query: `${entry.source.slug}: ${attempt.query}`,
          chunkCount: attempt.chunkCount,
          insufficient: attempt.insufficient,
          attemptType: "query" as const,
          prunedCount: attempt.chunkCount,
        })),
      ),
      chunks: agentChunks.map(toRetrievalMetaChunk),
      queries:
        rewrittenQueries.length > 0 ? rewrittenQueries : [question],
    };
    requestContext?.set?.(LEDGEINDEX_RETRIEVAL_META_KEY, meta);

    logVerbose("Explore retrieve finished", "ExploreQuery", {
      question,
      picked: picked.map((s) => s.slug),
      rewrittenQueries,
      rewriteMethod,
      cascadePassUsed,
      cascadeTopScore,
      chunkCount: agentChunks.length,
      answerMode: coverage.answerMode,
      coverageTier: coverage.coverageTier,
    });

    const retrievalInstruction = instructionForAnswerMode(
      coverage.answerMode,
      coverage.coverageReason,
    );
    const pickedLine = `Selected sources: ${picked
      .map((s) => `${s.name} (${s.slug})`)
      .join(", ")}.`;
    const sourceBlock =
      coverage.answerMode === "none"
        ? ""
        : `\n\nRetrieved sources:\n${formatChunksForContext(agentChunks)}`;

    return {
      messages,
      systemMessages: appendSystem(
        systemMessages,
        [retrievalInstruction, pickedLine, sourceBlock]
          .map((part) => part.trim())
          .filter(Boolean)
          .join("\n\n"),
      ),
    };
  }
}
