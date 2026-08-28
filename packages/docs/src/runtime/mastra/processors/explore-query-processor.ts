import type { Processor, ProcessInputArgs } from "@mastra/core/processors";
import type { MastraDBMessage } from "@mastra/core/agent";
import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import type { KapaRetrievedChunk } from "../../retrieval/kapa-retrieve.js";
import { isDirectHit, kapaRetrieveMany } from "../../retrieval/kapa-retrieve.js";
import {
  LEDGEINDEX_RETRIEVAL_META_KEY,
  toRetrievalMetaChunk,
  type RetrievalMeta,
} from "../../retrieval/retrieval-meta.js";
import {
  assessCoverage,
  instructionForAnswerMode,
} from "../../retrieval/assess-coverage.js";
import { maybeFilterRetrievedPages } from "../../retrieval/filter-retrieved-pages.js";
import { rewriteQueries, type RewriteResult } from "../../retrieval/rewrite-queries.js";
import { ensureCatalogHasPages } from "../../retrieval/page-catalog-rebuild.js";
import { getMetadataCatalog } from "../../retrieval/metadata-catalog-store.js";
import { formatCatalogForAgent } from "../../retrieval/search-query-planner.js";
import type { MetadataCatalog } from "../../retrieval/metadata-catalog.js";
import { agentStructuredOutput } from "../../llm/agent-structured-output.js";
import {
  primaryAuxiliaryModelId,
  resolveRewriteModelConfig,
} from "../../llm/chat-model-config.js";
import {
  listGlobalSourceSummaries,
  listSourceSummariesForOwner,
} from "../../services/source-summary.js";
import { getStore } from "../../db/index.js";
import type { SourceContentType } from "../../db/types.js";
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
import {
  describeRerankRuntimeMeta,
  type RerankBackend,
} from "../../retrieval/rerank-backend.js";

const MAX_PICKED_SOURCES = 3;
const MAX_HISTORY_TURNS = 6;
const AGENT_CHUNK_BUDGET = 24;

type ExploreSource = {
  id: string;
  slug: string;
  name: string;
  scope: "personal" | "global";
  hosting: "local" | "cloud";
  /** True only when this source came from LEDGEINDEX_REMOTE_API_URL (needs Bearer). */
  remote: boolean;
  /** Corpus kind, so the picker can route code questions apart from prose ones. */
  sourceType: SourceContentType;
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
        : ""
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

function readAuthToken(
  requestContext: ProcessInputArgs["requestContext"]
): string {
  if (typeof requestContext?.get !== "function") return "";
  const token = requestContext.get("auth_token");
  return typeof token === "string" ? token.trim() : "";
}

/** Set id or slug chosen ahead of the turn; empty means the whole catalog. */
function readSourceSetRef(
  requestContext: ProcessInputArgs["requestContext"]
): string {
  if (typeof requestContext?.get !== "function") return "";
  const raw =
    requestContext.get("source_set_id") ??
    requestContext.get("source_set_slug") ??
    "";
  return typeof raw === "string" ? raw.trim() : "";
}

/**
 * Inline allowlist of slugs, for callers that pin sources per call instead of
 * saving a set (SDK/CLI). Accepts an array or a comma-separated string.
 */
function readSourceSlugs(
  requestContext: ProcessInputArgs["requestContext"]
): string[] {
  if (typeof requestContext?.get !== "function") return [];
  const raw = requestContext.get("explore_source_slugs");
  const values = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(",")
      : [];
  return values
    .map((value) => String(value).trim().toLowerCase())
    .filter(Boolean);
}

/** `picker` = LLM chooses subset; `all` = read every allowed source. */
function readSourceMode(
  requestContext: ProcessInputArgs["requestContext"]
): "picker" | "all" {
  if (typeof requestContext?.get !== "function") return "picker";
  const raw = requestContext.get("explore_source_mode");
  return raw === "all" ? "all" : "picker";
}

function readUserId(
  requestContext: ProcessInputArgs["requestContext"]
): string {
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
      process.env.LEDGEINDEX_LOCAL_USER_ID?.trim() || "ledgeindex-desktop-local"
    );
  }
  return [...ids];
}

/** What the picker sees: "code" for a checkout, "docs" for anything crawled. */
function describeKind(sourceType: SourceContentType): "code" | "docs" {
  return sourceType === "repository" ? "code" : "docs";
}

function formatCatalog(sources: ExploreSource[]): string {
  if (sources.length === 0) return "(no sources indexed)";
  return sources
    .map((source) => {
      const origin = source.remote ? "remote" : "local";
      return `- ${source.name} (slug: ${source.slug}, kind: ${describeKind(source.sourceType)}, scope: ${source.scope}, origin: ${origin}, pages: ${source.pageCount}, chunks: ${source.chunkCount})`;
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
  index: number
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

function chunkKey(chunk: KapaRetrievedChunk): string {
  return `${chunk.url}::${chunk.text.slice(0, 120)}`;
}

function dedupeChunks(chunks: KapaRetrievedChunk[]): KapaRetrievedChunk[] {
  const seen = new Set<string>();
  const out: KapaRetrievedChunk[] = [];
  for (const chunk of chunks) {
    const key = chunkKey(chunk);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(chunk);
  }
  return out;
}

/**
 * Take from each picked source in turn, by that source's own rank.
 *
 * Scores are only comparable inside one source: a code source ranks on cosine
 * while a prose source ranks on cross-encoder output, so sorting the union by
 * score hands the whole budget to whichever side happens to score hotter.
 * Rank is the one ordering every source agrees on.
 */
function mergeAcrossSources(
  groups: KapaRetrievedChunk[][],
  limit: number
): KapaRetrievedChunk[] {
  const queues = groups
    .filter((group) => group.length > 0)
    .map((group) => [...group]);
  const seen = new Set<string>();
  const out: KapaRetrievedChunk[] = [];

  while (out.length < limit) {
    let tookOne = false;
    for (const queue of queues) {
      let next = queue.shift();
      while (next && seen.has(chunkKey(next))) next = queue.shift();
      if (!next) continue;
      seen.add(chunkKey(next));
      out.push(next);
      tookOne = true;
      if (out.length >= limit) break;
    }
    if (!tookOne) break;
  }

  return out;
}

async function loadPersonalSources(userId: string): Promise<ExploreSource[]> {
  const ownerIds = personalOwnerIds(userId);
  if (ownerIds.length === 0) return [];

  const batches = await Promise.all(
    ownerIds.map((id) => listSourceSummariesForOwner(id))
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
        sourceType: item.sourceType,
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
    sourceType: item.sourceType,
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
  authToken: string
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
        sourceType: item.sourceType ?? "unknown",
        pageCount: item.pageCount,
        chunkCount: item.chunkCount,
        faviconUrl: item.faviconUrl ?? null,
        startUrl: item.startUrl || null,
      })),
    };
  }

  return { sources: await loadLocalGlobalSources() };
}

/**
 * A source set is the ahead-of-time answer to "which corpora may this question
 * touch" — pin a repo and its docs to a set, and the picker chooses within it
 * instead of the whole catalog.
 */
async function resolveSourceSetScope(input: {
  sourceSetRef: string;
  userId: string;
}): Promise<{ name: string; sourceIds: Set<string> } | null> {
  const store = getStore();
  const set =
    (await store.getSourceSet(input.sourceSetRef)) ??
    (input.userId
      ? await store.getSourceSetBySlug(input.userId, input.sourceSetRef)
      : null);
  if (!set) return null;
  if (input.userId && set.ownerUserId !== input.userId) return null;
  return { name: set.name, sourceIds: new Set(set.sourceIds) };
}

/** Personal (always local) + platform (remote only with auth, else local). */
async function loadExploreSources(input: {
  authToken: string;
  userId: string;
  /** Set id or slug. When given, the picker only sees this set's members. */
  sourceSetRef: string;
  /** Inline slug allowlist, applied on top of any set scope. */
  sourceSlugs: string[];
}): Promise<{
  sources: ExploreSource[];
  platformError?: string;
  sourceSetName?: string;
  sourceSetError?: string;
}> {
  const [personal, platform] = await Promise.all([
    loadPersonalSources(input.userId),
    loadPlatformSources(input.authToken),
  ]);
  let sources = [...personal, ...platform.sources];

  if (input.sourceSlugs.length > 0) {
    const allowed = new Set(input.sourceSlugs);
    sources = sources.filter((source) =>
      allowed.has(source.slug.toLowerCase())
    );
  }

  if (!input.sourceSetRef) {
    return { sources, platformError: platform.error };
  }

  const scope = await resolveSourceSetScope({
    sourceSetRef: input.sourceSetRef,
    userId: input.userId,
  });
  if (!scope) {
    return {
      sources: [],
      platformError: platform.error,
      sourceSetError: `Source set "${input.sourceSetRef}" was not found.`,
    };
  }

  return {
    sources: sources.filter((source) => scope.sourceIds.has(source.id)),
    platformError: platform.error,
    sourceSetName: scope.name,
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
  fn: () => Promise<T>
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
    fn
  );
}

async function loadSourceCatalog(input: {
  source: ExploreSource;
  authToken: string;
}): Promise<{ text: string; pages: MetadataCatalog["pages"] }> {
  if (usesRemoteCorpus(input.source)) {
    if (!input.authToken) {
      return { text: "No catalog available.", pages: [] };
    }
    const remote = await remoteGetMetadataCatalog(
      input.authToken,
      input.source.id
    );
    if (!remote.ok) {
      logWarn(remote.message, "ExploreQuery", {
        sourceId: input.source.id,
        step: "catalog",
      });
      return { text: "No catalog available.", pages: [] };
    }
    const catalog = remote.catalog as MetadataCatalog | null;
    return {
      text: formatCatalogForAgent(catalog),
      pages: catalog?.pages ?? [],
    };
  }

  const catalog =
    (await ensureCatalogHasPages(input.source.id)) ??
    (await getMetadataCatalog(input.source.id));
  return {
    text: formatCatalogForAgent(catalog),
    pages: catalog?.pages ?? [],
  };
}

async function retrieveSourceHits(input: {
  source: ExploreSource;
  rewrite: RewriteResult;
  /** Original user question, retained in fusion retrieval. */
  question: string;
  authToken: string;
}): Promise<{
  chunks: KapaRetrievedChunk[];
  insufficient: boolean;
  relaxedPassUsed: boolean;
  /** Undefined for a remote source, which does not report its backend back. */
  rerankBackendUsed?: string;
  byQuery: Array<{ query: string; chunkCount: number; insufficient: boolean }>;
}> {
  const queries =
    input.rewrite.queries.length > 0
      ? input.rewrite.queries.slice(0, 6)
      : ["documentation"];

  if (usesRemoteCorpus(input.source)) {
    const rerankBackend = getRequestRerankBackend();
    const remote = await remoteAskSource(
      input.authToken,
      input.source.id,
      input.question,
      rerankBackend ? { rerankBackend } : undefined,
    );
    if (!remote.ok) {
      logWarn(remote.message, "ExploreQuery", {
        sourceId: input.source.id,
        question: input.question,
      });
      return {
        chunks: [],
        insufficient: true,
        relaxedPassUsed: false,
        byQuery: [
          {
            query: input.question,
            chunkCount: 0,
            insufficient: true,
          },
        ],
      };
    }
    const hits = Array.isArray(remote.result.chunks)
      ? remote.result.chunks
      : [];
    const insufficient =
      remote.result.insufficient !== undefined
        ? Boolean(remote.result.insufficient)
        : hits.length === 0;
    const chunks = hits.map((hit, index) =>
      hitToChunk(hit, input.source.name, index),
    );
    return {
      chunks,
      insufficient,
      relaxedPassUsed: false,
      byQuery: [
        {
          query: input.question,
          chunkCount: chunks.length,
          insufficient,
        },
      ],
    };
  }

  return withSourceRetrievalContext(input.source, async () => {
    let relaxedPassUsed = false;
    let retrieval = await kapaRetrieveMany({
      queries,
      question: input.question,
      rerankQuery: input.rewrite.rerankQuery,
      sourceId: input.source.id,
      catalogQueries: input.rewrite.catalogQueries,
    });

    if (retrieval.merged.length === 0) {
      retrieval = await kapaRetrieveMany({
        queries,
        question: input.question,
        rerankQuery: input.rewrite.rerankQuery,
        sourceId: input.source.id,
        catalogQueries: input.rewrite.catalogQueries,
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
      rerankBackendUsed: retrieval.rerankBackendUsed,
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
  requestContext?: { get?: (key: string) => unknown };
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
    model: resolveRewriteModelConfig(input.requestContext),
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
      routerSchema
    );
    if (object) {
      return { intent: object.intent, reason: object.reason };
    }
  } catch (error) {
    logWarn(
      error instanceof Error ? error.message : "Explore router failed",
      "ExploreQuery"
    );
  }
  return null;
}

async function routeExploreIntent(input: {
  question: string;
  history: string;
  catalogText: string;
  requestContext?: { get?: (key: string) => unknown };
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
  requestContext?: { get?: (key: string) => unknown };
}): Promise<string[]> {
  if (input.sources.length === 0) return [];
  if (input.sources.length === 1) return [input.sources[0]!.slug];

  const agent = new Agent({
    id: "explore-source-picker-agent",
    name: "Explore Source Picker",
    instructions: `Pick up to ${MAX_PICKED_SOURCES} source slugs that are most likely to answer the user's question.
Only use slugs from the provided catalog (personal and/or global). Prefer fewer sources when one is clearly enough.

Each source has a kind:
- "code" is an indexed repository — actual implementation, function bodies, types, internal helpers, tests.
- "docs" is an indexed site — public API surface, guides, configuration, examples, concepts.

Routing rules:
- "How do I use / configure / get started / what does this option mean" → prefer docs.
- "How is it implemented / why does it behave this way / what does this function do internally / where is X defined / is this a bug" → prefer code.
- Pick both a code and a docs source when the question spans documented behaviour and its implementation, when the docs may be incomplete or stale, or when you cannot tell which side holds the answer.
- Never pick a second source just to be thorough. One is right when the question clearly belongs to one side.`,
    model: resolveRewriteModelConfig(input.requestContext),
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
      pickerSchema
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
      "ExploreQuery"
    );
  }

  return input.sources.slice(0, 1).map((s) => s.slug);
}

function appendSystem(
  systemMessages: ProcessInputArgs["systemMessages"],
  content: string
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
    const sourceSetRef = readSourceSetRef(requestContext);
    const sourceSlugs = readSourceSlugs(requestContext);
    const history = buildHistory(messages);
    const loaded = await loadExploreSources({
      authToken,
      userId,
      sourceSetRef,
      sourceSlugs,
    });
    const catalogText = formatCatalog(loaded.sources);

    if (loaded.sourceSetError) {
      return {
        messages,
        systemMessages: appendSystem(
          systemMessages,
          `${loaded.sourceSetError}
Tell the user the selected source set is unavailable and that they should pick another set or ask without one.`
        ),
      };
    }

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
Tell the user they need to sign in to explore remote global sources, or index a personal source locally first.`
        ),
      };
    }

    const sourceMode = readSourceMode(requestContext);
    const forceRetrieve =
      sourceMode === "all" || sourceSlugs.length > 0 || Boolean(sourceSetRef);

    const routed = forceRetrieve
      ? {
          intent: "retrieve" as const,
          reason: "Pinned sources — skip chat routing.",
        }
      : await routeExploreIntent({
          question,
          history,
          catalogText,
          requestContext,
        });

    logVerbose("Explore router decided", "ExploreQuery", {
      question,
      intent: routed.intent,
      reason: routed.reason,
      sourceCount: loaded.sources.length,
      personalCount: loaded.sources.filter((s) => s.scope === "personal")
        .length,
      platformError: loaded.platformError,
      sourceMode,
      forceRetrieve,
      modelId: primaryAuxiliaryModelId(requestContext),
    });

    if (routed.intent === "chat") {
      return {
        messages,
        systemMessages: appendSystem(
          systemMessages,
          `The user does not need corpus retrieval for this turn.
Answer helpfully. If useful, mention they can ask about available sources (personal or global) or ask a docs question.`
        ),
      };
    }

    if (loaded.sources.length === 0) {
      if (loaded.sourceSetName) {
        return {
          messages,
          systemMessages: appendSystem(
            systemMessages,
            `The source set "${loaded.sourceSetName}" has no indexed sources in it.
Tell the user to add a source to that set, or to ask without a set selected.`
          ),
        };
      }
      return {
        messages,
        systemMessages: appendSystem(
          systemMessages,
          `No knowledge sources are available yet.
Tell the user clearly that there are no personal or platform sources indexed.${
            loaded.platformError ? `\nAlso note: ${loaded.platformError}` : ""
          }`
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
${catalogText}${platformNote}`
        ),
      };
    }

    const pickedSlugs =
      readSourceMode(requestContext) === "all"
        ? loaded.sources.slice(0, MAX_PICKED_SOURCES).map((s) => s.slug)
        : await pickSources({
            question,
            history,
            sources: loaded.sources,
            requestContext,
          });
    const picked = pickedSlugs
      .map((slug) =>
        loaded.sources.find((s) => s.slug.toLowerCase() === slug.toLowerCase())
      )
      .filter((s): s is ExploreSource => Boolean(s))
      .slice(0, MAX_PICKED_SOURCES);

    logVerbose("Explore sources picked", "ExploreQuery", {
      question,
      slugs: picked.map((s) => s.slug),
      kinds: picked.map((s) => describeKind(s.sourceType)),
      sourceSet: loaded.sourceSetName ?? null,
      sourceMode: readSourceMode(requestContext),
      candidateCount: loaded.sources.length,
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
            })
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
                catalogQueries: [] as string[],
                topicScope: "single" as const,
                method: "cascade" as const,
                rewriteModelId: primaryAuxiliaryModelId(requestContext),
              },
              chunks,
              insufficient: chunks.length === 0,
              relaxedPassUsed: false,
              // The cascade answers from cached chunks without a rerank pass.
              rerankBackendUsed: undefined as string | undefined,
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

        const catalog = await loadSourceCatalog({ source, authToken });
        const rewrite = await rewriteQueries({
          question,
          catalogText: catalog.text,
          history,
          pages: catalog.pages,
          requestContext,
        });
        const result = await retrieveSourceHits({
          source,
          rewrite,
          question,
          authToken,
        });
        return {
          source,
          rewrite,
          ...result,
          cascadePassUsed: false as const,
          cascadeTopScore: undefined as number | undefined,
        };
      })
    );

    let agentChunks = mergeAcrossSources(
      perSource.map((entry) => entry.chunks),
      AGENT_CHUNK_BUDGET
    );
    const relaxedPassUsed = perSource.some((entry) => entry.relaxedPassUsed);
    const cascadePassUsed = perSource.some((entry) => entry.cascadePassUsed);
    const catalogQueries = [
      ...new Set(
        perSource.flatMap((entry) => entry.rewrite.catalogQueries ?? []),
      ),
    ];
    const filtered = await maybeFilterRetrievedPages({
      question,
      chunks: agentChunks,
      catalogQueries,
      requestContext,
      cascadePassUsed,
      relaxedPassUsed,
    });
    agentChunks = filtered.kept;
    const droppedPages = filtered.dropped;
    const pageFilterUsed = filtered.usedFilter;

    const insufficient = agentChunks.length === 0;
    const cascadeTopScore = perSource
      .map((entry) => entry.cascadeTopScore)
      .filter((score): score is number => typeof score === "number")
      .sort((a, b) => b - a)[0];
    // Expansion siblings carry a placeholder score, so score only real hits.
    const evidenceChunks = agentChunks.filter(isDirectHit);
    const { maxChunkScore, avgTop3Score } = scoreSummary(evidenceChunks);
    const coverage = await assessCoverage({
      question,
      chunks: evidenceChunks,
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
      (entry) => entry.rewrite.topicScope === "multi"
    );
    const rewriteModelId =
      perSource[0]?.rewrite.rewriteModelId ??
      primaryAuxiliaryModelId(requestContext);

    // Sources can rank differently — a code source skips the cross-encoder — so
    // only claim a specific backend when every source used the same one.
    const backendsUsed = [
      ...new Set(
        perSource
          .map((entry) => entry.rerankBackendUsed)
          .filter((backend): backend is string => Boolean(backend))
      ),
    ];
    const rerankRuntime = describeRerankRuntimeMeta({
      cascadePassUsed,
      effectiveBackend:
        backendsUsed.length === 1
          ? (backendsUsed[0] as RerankBackend)
          : undefined,
    });

    const meta: RetrievalMeta = {
      question,
      rewrittenQueries:
        rewrittenQueries.length > 0 ? rewrittenQueries : [question],
      catalogQueries,
      rewriteMethod,
      rewriteModelId,
      topicScope: picked.length > 1 || anyMulti ? "multi" : "single",
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
        kind: describeKind(source.sourceType),
      })),
      searchAttempts: perSource.flatMap((entry) =>
        entry.byQuery.map((attempt) => ({
          query: `${entry.source.slug}: ${attempt.query}`,
          chunkCount: attempt.chunkCount,
          insufficient: attempt.insufficient,
          attemptType: "query" as const,
          prunedCount: attempt.chunkCount,
        }))
      ),
      chunks: agentChunks.map(toRetrievalMetaChunk),
      droppedPages,
      pageFilterUsed,
      queries: rewrittenQueries.length > 0 ? rewrittenQueries : [question],
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
      coverage.coverageReason
    );
    const pickedLine = `Selected sources: ${picked
      .map((s) => `${s.name} (${s.slug}, ${describeKind(s.sourceType)})`)
      .join(", ")}.`;
    // Docs describe intent, code describes behaviour, and stale docs are common.
    const mixedKindNote =
      new Set(picked.map((s) => describeKind(s.sourceType))).size > 1
        ? "This evidence spans both documentation and repository code. Where they disagree, describe what the code does and say the docs differ."
        : "";
    const sourceBlock =
      coverage.answerMode === "none"
        ? ""
        : `\n\nRetrieved sources:\n${formatChunksForContext(agentChunks)}`;

    return {
      messages,
      systemMessages: appendSystem(
        systemMessages,
        [retrievalInstruction, pickedLine, mixedKindNote, sourceBlock]
          .map((part) => part.trim())
          .filter(Boolean)
          .join("\n\n")
      ),
    };
  }
}
