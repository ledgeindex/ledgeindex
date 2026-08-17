import type { Processor, ProcessInputArgs } from "@mastra/core/processors";
import type { MastraDBMessage } from "@mastra/core/agent";
import { getMetadataCatalog } from "../../retrieval/metadata-catalog-store.js";
import { ensureCatalogHasPages } from "../../retrieval/page-catalog-rebuild.js";
import { resolveCatalogUrlFilter, resolveDomainHintsUrlPrefix, pickNarrowerUrlPrefix } from "../../retrieval/rank-catalog-pages.js";
import { buildRerankQuery } from "@ledgeindex/core/query/query-intent.js";
import {
  formatCatalogForAgent,
  filterCatalogByUrlPrefix,
} from "../../retrieval/search-query-planner.js";
import {
  kapaRetrieveMany,
  type KapaRetrievedChunk,
} from "../../retrieval/kapa-retrieve.js";
import { tryCascadeRetrieve } from "../../retrieval/cascade-retrieve.js";
import {
  LEDGEINDEX_RETRIEVAL_META_KEY,
  toRetrievalMetaChunk,
  type RetrievalMeta,
  type RetrievalTimingStep,
} from "../../retrieval/retrieval-meta.js";
import { rewriteQueries } from "../../retrieval/rewrite-queries.js";
import {
  assessCoverage,
  instructionForAnswerMode,
} from "../../retrieval/assess-coverage.js";
import { logVerbose } from "../../lib/logger.js";
import { getSourceSummary } from "../../services/source-summary.js";
import { primaryAuxiliaryModelId } from "../../llm/chat-model-config.js";
import { describeRerankRuntimeMeta } from "../../retrieval/rerank-backend.js";
import {
  isRequestRerankBackend,
  isSourceHosting,
  isSourceScope,
  readRetrievalSettingsFromRequestContext,
  resolveRetrievalSettings,
  runWithRetrievalContext,
  isRetrievalStrictness,
  DEFAULT_RETRIEVAL_STRICTNESS,
} from "../../retrieval/rerank-request-context.js";
import {
  RELEVANCE_THRESHOLD,
  RELAXED_RELEVANCE_THRESHOLD,
} from "../../vector/constants.js";

const MAX_HISTORY_TURNS = 6;

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

/** Full chunk text — already bounded at ingest (~1024 tokens). No truncation. */
function formatChunksForContext(chunks: KapaRetrievedChunk[]): string {
  return chunks
    .map((chunk, index) => {
      const heading =
        chunk.section.trim() || chunk.category.trim() || chunk.title.trim();
      // Code chunks know their exact span, so the answer can cite a line range
      // instead of a whole file.
      const location =
        chunk.filePath && chunk.startLine
          ? `Location: ${chunk.filePath}:${chunk.startLine}-${chunk.endLine ?? chunk.startLine}${
              chunk.symbolName
                ? ` (${chunk.symbolKind ?? "symbol"} ${chunk.symbolName})`
                : ""
            }\n`
          : "";
      return `### Source ${index + 1}: ${chunk.title}
URL: ${chunk.url}
${location}Section: ${heading}
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

function elapsedMs(started: number): number {
  return Math.round(performance.now() - started);
}

function pushRetrievePhaseSteps(
  steps: RetrievalTimingStep[],
  retrieval: Awaited<ReturnType<typeof kapaRetrieveMany>>,
  { idPrefix, labelPrefix }: { idPrefix: string; labelPrefix: string }
) {
  const timings = retrieval.timings;
  if (!timings) return;

  const multi =
    timings.queryCount > 1
      ? `sum across ${timings.queryCount} queries`
      : undefined;

  steps.push({
    id: `${idPrefix}-wall`,
    label: `${labelPrefix} (wall)`,
    ms: timings.wallMs,
    detail:
      timings.queryCount > 1
        ? `${timings.queryCount} queries · phase sums may exceed wall when parallel`
        : undefined,
  });
  steps.push({
    id: `${idPrefix}-embed`,
    label: `${labelPrefix} · embed`,
    ms: timings.embedMs,
    detail: multi,
  });
  steps.push({
    id: `${idPrefix}-vector`,
    label: `${labelPrefix} · vector`,
    ms: timings.vectorMs,
    detail: multi,
  });
  steps.push({
    id: `${idPrefix}-rerank`,
    label: `${labelPrefix} · rerank`,
    ms: timings.rerankMs,
    detail: multi,
  });
  steps.push({
    id: `${idPrefix}-expand`,
    label: `${labelPrefix} · expand`,
    ms: timings.expandMs,
    detail: multi,
  });
}

function mergePathFilterWithDomainHints(
  pathFilter: { crawlRoot?: string; urlPrefix?: string } | undefined,
  domainHintsUrlPrefix: string | undefined,
): { crawlRoot?: string; urlPrefix?: string } | undefined {
  if (!domainHintsUrlPrefix) return pathFilter;
  const narrowed = pickNarrowerUrlPrefix(
    pathFilter?.urlPrefix,
    domainHintsUrlPrefix,
  );
  if (!pathFilter && !narrowed) return undefined;
  return {
    ...(pathFilter?.crawlRoot ? { crawlRoot: pathFilter.crawlRoot } : {}),
    ...(narrowed ? { urlPrefix: narrowed } : {}),
  };
}

function buildRetrievalMeta(input: {
  question: string;
  rewrittenQueries: string[];
  rerankQuery?: string;
  rewriteMethod: RetrievalMeta["rewriteMethod"];
  rewriteModelId?: string;
  topicScope?: RetrievalMeta["topicScope"];
  skippedQueries?: string[];
  insufficient: boolean;
  partial: boolean;
  byQuery: Awaited<ReturnType<typeof kapaRetrieveMany>>["byQuery"];
  chunks: KapaRetrievedChunk[];
  catalogUrlFilter?: RetrievalMeta["catalogUrlFilter"];
  coverage: Awaited<ReturnType<typeof assessCoverage>>;
  cascadePassUsed?: boolean;
  cascadeTopScore?: number;
  weakEvidenceUsed?: boolean;
  rerankBackendUsed?: Awaited<
    ReturnType<typeof kapaRetrieveMany>
  >["rerankBackendUsed"];
  timings?: RetrievalMeta["timings"];
  retrievalSettings?: {
    strictness?: RetrievalMeta["retrievalStrictness"];
    relevanceThreshold: number;
    relaxedThreshold: number;
    includeWeakEvidence: boolean;
  };
}): RetrievalMeta {
  const { maxChunkScore, avgTop3Score } = scoreSummary(input.chunks);
  const rerankRuntime = describeRerankRuntimeMeta({
    cascadePassUsed: input.cascadePassUsed,
    effectiveBackend: input.rerankBackendUsed,
  });

  return {
    question: input.question,
    rewrittenQueries: input.rewrittenQueries,
    rerankQuery: input.rerankQuery,
    rewriteMethod: input.rewriteMethod,
    rewriteModelId: input.rewriteModelId,
    topicScope: input.topicScope,
    skippedQueries: input.skippedQueries,
    queries: input.rewrittenQueries,
    insufficient: input.insufficient,
    partial: input.partial,
    maxChunkScore,
    avgTop3Score,
    catalogUrlFilter: input.catalogUrlFilter,
    relaxedPassUsed: input.coverage.relaxedPassUsed,
    weakEvidenceUsed: input.weakEvidenceUsed,
    retrievalStrictness:
      input.retrievalSettings?.strictness ?? DEFAULT_RETRIEVAL_STRICTNESS,
    relevanceThreshold:
      input.retrievalSettings?.relevanceThreshold ?? RELEVANCE_THRESHOLD,
    relaxedThreshold:
      input.retrievalSettings?.relaxedThreshold ?? RELAXED_RELEVANCE_THRESHOLD,
    cascadePassUsed: input.cascadePassUsed,
    cascadeTopScore: input.cascadeTopScore,
    rerankBackend: rerankRuntime.rerankBackend,
    rerankDevice: rerankRuntime.rerankDevice,
    rerankDeviceLabel: rerankRuntime.rerankDeviceLabel,
    answerMode: input.coverage.answerMode,
    coverageTier: input.coverage.coverageTier,
    coverageGraderUsed: input.coverage.coverageGraderUsed,
    coverageReason: input.coverage.coverageReason,
    coverageModelId: input.coverage.coverageModelId,
    searchAttempts: input.byQuery.map((entry) => ({
      query: entry.query,
      chunkCount: entry.rawPrunedCount,
      insufficient: entry.insufficient,
      attemptType: entry.attemptType,
      filter: entry.filter,
      catalogMatchScore: entry.catalogMatchScore,
      initialCount: entry.initialCount,
      rerankedCount: entry.rerankedCount,
      directHitCount: entry.directHitCount,
      directHitScores: entry.directHitScores,
      rerankTopScores: entry.rerankTopScores,
      prunedCount: entry.prunedCount,
    })),
    chunks: input.chunks.map(toRetrievalMetaChunk),
    timings: input.timings,
  };
}

function buildMultiPartAnswerInstruction(
  topicScope: "single" | "multi"
): string {
  if (topicScope !== "multi") return "";

  return `The user's latest message asks about multiple distinct topics.
Structure your answer to address each part of the user's question separately — use a clear heading for each part, in the order the user asked.
If the sources do not cover one part, say so for that part only; still answer the other parts from the sources.`;
}

/**
 * Kapa-style pre-step: rewrite the question, run retrieval, evaluate sources,
 * and inject the result into system context before the answer agent runs.
 */
export class RAGQueryProcessor implements Processor {
  readonly id = "rag-query";
  readonly name = "RAG Query";

  async processInput({
    messages,
    systemMessages,
    requestContext,
  }: ProcessInputArgs) {
    const sourceId =
      typeof requestContext?.get === "function"
        ? String(requestContext.get("source_id") ?? "").trim()
        : "";
    if (!sourceId) return messages;

    const sourceScopeRaw =
      typeof requestContext?.get === "function"
        ? requestContext.get("source_scope")
        : undefined;
    const sourceScope = isSourceScope(sourceScopeRaw)
      ? sourceScopeRaw
      : "personal";
    const hostingRaw =
      typeof requestContext?.get === "function"
        ? requestContext.get("source_hosting")
        : undefined;
    const sourceHosting = isSourceHosting(hostingRaw)
      ? hostingRaw
      : sourceScope === "global"
        ? "cloud"
        : "local";
    const backendRaw =
      typeof requestContext?.get === "function"
        ? requestContext.get("rerank_backend")
        : undefined;
    // Cloud indexes always use Cohere; local indexes honor the UI Local/Cloud toggle.
    const backend =
      sourceHosting === "cloud"
        ? "cohere-auto"
        : isRequestRerankBackend(backendRaw)
          ? backendRaw
          : undefined;

    const strictnessRaw = requestContext?.get?.("retrieval_strictness");
    const includeWeakRaw = requestContext?.get?.("include_weak_evidence");
    const chatRetrievalSettings = resolveRetrievalSettings({
      strictness: isRetrievalStrictness(strictnessRaw) ? strictnessRaw : undefined,
      includeWeakEvidence:
        typeof includeWeakRaw === "boolean" ? includeWeakRaw : undefined,
    });

    return runWithRetrievalContext(
      {
        sourceScope,
        sourceHosting,
        ...(backend ? { backend } : {}),
        retrievalStrictness: chatRetrievalSettings.strictness,
        relevanceThreshold: chatRetrievalSettings.relevanceThreshold,
        includeWeakEvidence: chatRetrievalSettings.includeWeakEvidence,
      },
      () =>
        this.runRagWithContext({
          messages,
          systemMessages,
          requestContext,
          sourceId,
        })
    );
  }

  private async runRagWithContext({
    messages,
    systemMessages,
    requestContext,
    sourceId,
  }: {
    messages: ProcessInputArgs["messages"];
    systemMessages: ProcessInputArgs["systemMessages"];
    requestContext: ProcessInputArgs["requestContext"];
    sourceId: string;
  }) {
    const docsUrlPrefix =
      typeof requestContext?.get === "function"
        ? String(requestContext.get("docs_url_prefix") ?? "").trim()
        : "";
    const docsCrawlRoot =
      typeof requestContext?.get === "function"
        ? String(requestContext.get("docs_crawl_root") ?? "").trim()
        : "";
    const pathFilter =
      docsUrlPrefix || docsCrawlRoot
        ? {
            ...(docsCrawlRoot ? { crawlRoot: docsCrawlRoot } : {}),
            ...(docsUrlPrefix ? { urlPrefix: docsUrlPrefix } : {}),
          }
        : undefined;

    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const question = lastUser ? textFromMessage(lastUser) : "";
    if (!question) return messages;

    const ragStarted = performance.now();
    const timingSteps: RetrievalTimingStep[] = [];

    const catalogStarted = performance.now();
    const catalogRecord =
      (await ensureCatalogHasPages(sourceId)) ??
      (await getMetadataCatalog(sourceId));
    // Path scope (Docs / Guides) must narrow rewrite + catalog URL hints, not just retrieval.
    const scopedCatalog = filterCatalogByUrlPrefix(
      catalogRecord,
      docsUrlPrefix || docsCrawlRoot || null
    );
    const catalogText = formatCatalogForAgent(scopedCatalog);
    const history = buildHistory(messages);
    const retrievalSettings = readRetrievalSettingsFromRequestContext(
      requestContext,
    );
    timingSteps.push({
      id: "catalog",
      label: "Catalog",
      ms: elapsedMs(catalogStarted),
    });

    // Cascade: cheap vector peek on the raw question — skip rewrite + rerank on slam dunks.
    const cascadeStarted = performance.now();
    const cascade = await tryCascadeRetrieve({
      query: question,
      sourceId,
      filter: pathFilter,
    });
    timingSteps.push({
      id: "cascade",
      label: cascade ? "Cascade (hit)" : "Cascade (miss/off)",
      ms: elapsedMs(cascadeStarted),
      detail: cascade ? `top ${cascade.topScore.toFixed(2)}` : undefined,
    });

    if (cascade) {
      const agentChunks = cascade.chunks;
      const insufficient = agentChunks.length === 0;
      const { maxChunkScore, avgTop3Score } = scoreSummary(agentChunks);
      const coverageStarted = performance.now();
      const coverage = await assessCoverage({
        question,
        chunks: agentChunks,
        insufficient,
        relaxedPassUsed: false,
        maxChunkScore,
        avgTop3Score,
        requestContext,
      });
      timingSteps.push({
        id: "coverage",
        label: coverage.coverageGraderUsed ? "Coverage (grader)" : "Coverage",
        ms: elapsedMs(coverageStarted),
        detail: coverage.coverageModelId
          ? coverage.coverageModelId
          : coverage.answerMode,
      });
      const sourceSummary = await getSourceSummary(sourceId);
      const meta = buildRetrievalMeta({
        question,
        rewrittenQueries: [question],
        rewriteMethod: "cascade",
        rewriteModelId: primaryAuxiliaryModelId(requestContext),
        topicScope: "single",
        skippedQueries: [],
        insufficient,
        partial: coverage.answerMode === "partial",
        byQuery: [
          {
            query: question,
            chunks: agentChunks,
            pruned: agentChunks,
            prunedCount: agentChunks.length,
            rawPrunedCount: agentChunks.length,
            insufficient,
            attemptType: "query" as const,
            filter: pathFilter ?? {},
            initialCount: cascade.candidateCount,
            rerankedCount: 0,
            directHitCount: agentChunks.length,
            directHitScores: agentChunks.map((c) => c.score),
            rerankTopScores: [],
          },
        ],
        chunks: agentChunks,
        coverage,
        cascadePassUsed: true,
        cascadeTopScore: cascade.topScore,
        retrievalSettings,
        timings: {
          totalMs: elapsedMs(ragStarted),
          steps: timingSteps,
        },
      });
      if (sourceSummary) {
        meta.pickedSources = [
          {
            id: sourceSummary.id,
            slug: sourceSummary.slug,
            name: sourceSummary.name,
            faviconUrl: sourceSummary.faviconUrl ?? null,
            startUrl: sourceSummary.startUrl || null,
          },
        ];
      }

      requestContext?.set?.(LEDGEINDEX_RETRIEVAL_META_KEY, meta);

      logVerbose("RAG cascade early-exit", "RAGQuery", {
        sourceId,
        question,
        topScore: cascade.topScore,
        chunkCount: agentChunks.length,
        answerMode: coverage.answerMode,
        timings: meta.timings,
      });

      const retrievalInstruction = instructionForAnswerMode(
        coverage.answerMode,
        coverage.coverageReason
      );
      const sourceBlock =
        coverage.answerMode === "none"
          ? ""
          : `\n\nRetrieved sources:\n${formatChunksForContext(agentChunks)}`;

      const systemParts = [retrievalInstruction, sourceBlock]
        .map((part) => part.trim())
        .filter(Boolean);

      return {
        messages,
        systemMessages: [
          ...systemMessages,
          {
            role: "system" as const,
            content: systemParts.join("\n\n"),
          },
        ],
      };
    }

    const rewriteStarted = performance.now();
    const {
      queries,
      topicScope,
      domainHints,
      method: rewriteMethod,
      rewriteModelId,
    } = await rewriteQueries({
      question,
      catalogText,
      history,
      requestContext,
    });
    timingSteps.push({
      id: "rewrite",
      label: `Rewrite (${rewriteMethod})`,
      ms: elapsedMs(rewriteStarted),
      detail: rewriteModelId,
    });

    const domainHintsList = [
      ...new Set(
        (domainHints ?? []).map((hint) => hint.trim()).filter(Boolean),
      ),
    ];
    const domainHintsUrlPrefix =
      scopedCatalog?.pages?.length && domainHintsList.length > 0
        ? resolveDomainHintsUrlPrefix(domainHintsList, scopedCatalog.pages)
        : undefined;
    const retrievalPathFilter = mergePathFilterWithDomainHints(
      pathFilter,
      domainHintsUrlPrefix,
    );
    const rerankQuery = buildRerankQuery({ originalQuestion: question });

    const catalogUrlCandidate = scopedCatalog?.pages?.length
      ? resolveCatalogUrlFilter(question, scopedCatalog.pages)
      : null;
    const catalogUrlFilter = catalogUrlCandidate
      ? {
          url: catalogUrlCandidate.url,
          score: catalogUrlCandidate.score,
          title: catalogUrlCandidate.title,
        }
      : undefined;

    let relaxedPassUsed = false;
    let weakEvidenceUsed = false;
    const retrieveStrictStarted = performance.now();
    let retrieval = await kapaRetrieveMany({
      queries,
      question,
      sourceId,
      catalogUrlFilter,
      filter: retrievalPathFilter,
      relevanceThreshold: retrievalSettings.relevanceThreshold,
    });
    pushRetrievePhaseSteps(timingSteps, retrieval, {
      idPrefix: "retrieve-strict",
      labelPrefix: "Retrieve",
    });
    // Prefer wall from retrieveMany; keep a fallback if timings missing.
    if (!retrieval.timings) {
      timingSteps.push({
        id: "retrieve-strict-wall",
        label: "Retrieve (wall)",
        ms: elapsedMs(retrieveStrictStarted),
      });
    }

    if (
      retrieval.merged.length === 0 &&
      retrievalSettings.relaxedThreshold <
        retrievalSettings.relevanceThreshold
    ) {
      logVerbose(
        "RAG strict pass empty, retrying relaxed threshold",
        "RAGQuery",
        {
          sourceId,
          queries,
          topicScope,
          catalogUrlFilter: catalogUrlCandidate?.url,
          docsUrlPrefix: docsUrlPrefix || null,
          relaxedThreshold: retrievalSettings.relaxedThreshold,
        },
      );
      const retrieveRelaxedStarted = performance.now();
      retrieval = await kapaRetrieveMany({
        queries,
        question,
        sourceId,
        catalogUrlFilter,
        filter: retrievalPathFilter,
        relevanceThreshold: retrievalSettings.relaxedThreshold,
      });
      pushRetrievePhaseSteps(timingSteps, retrieval, {
        idPrefix: "retrieve-relaxed",
        labelPrefix: "Retrieve relaxed",
      });
      if (!retrieval.timings) {
        timingSteps.push({
          id: "retrieve-relaxed-wall",
          label: "Retrieve relaxed (wall)",
          ms: elapsedMs(retrieveRelaxedStarted),
        });
      }
      relaxedPassUsed = retrieval.merged.length > 0;
    }

    if (retrieval.merged.length === 0 && retrievalSettings.includeWeakEvidence) {
      logVerbose("RAG passes empty, trying weak-evidence fallback", "RAGQuery", {
        sourceId,
        queries,
        topicScope,
      });
      const retrieveWeakStarted = performance.now();
      retrieval = await kapaRetrieveMany({
        queries,
        question,
        sourceId,
        catalogUrlFilter,
        filter: retrievalPathFilter,
        relevanceThreshold: retrievalSettings.relevanceThreshold,
        allowWeakEvidence: true,
      });
      pushRetrievePhaseSteps(timingSteps, retrieval, {
        idPrefix: "retrieve-weak",
        labelPrefix: "Retrieve weak",
      });
      if (!retrieval.timings) {
        timingSteps.push({
          id: "retrieve-weak-wall",
          label: "Retrieve weak (wall)",
          ms: elapsedMs(retrieveWeakStarted),
        });
      }
      weakEvidenceUsed = retrieval.merged.length > 0;
    }

    const agentChunks = retrieval.merged;
    const insufficient = agentChunks.length === 0;
    const { maxChunkScore, avgTop3Score } = scoreSummary(agentChunks);
    const coverageStarted = performance.now();
    const coverage = await assessCoverage({
      question,
      chunks: agentChunks,
      insufficient,
      relaxedPassUsed,
      weakEvidenceUsed,
      maxChunkScore,
      avgTop3Score,
      requestContext,
    });
    timingSteps.push({
      id: "coverage",
      label: coverage.coverageGraderUsed ? "Coverage (grader)" : "Coverage",
      ms: elapsedMs(coverageStarted),
      detail: coverage.coverageModelId
        ? coverage.coverageModelId
        : coverage.answerMode,
    });
    const partial = relaxedPassUsed || weakEvidenceUsed;
    const sourceSummary = await getSourceSummary(sourceId);
    const meta = buildRetrievalMeta({
      question,
      rewrittenQueries: retrieval.queries,
      rerankQuery,
      rewriteMethod,
      rewriteModelId,
      topicScope,
      skippedQueries: retrieval.skippedQueries,
      insufficient,
      partial,
      byQuery: retrieval.byQuery,
      chunks: agentChunks,
      catalogUrlFilter: retrieval.catalogUrlFilter,
      coverage,
      weakEvidenceUsed,
      cascadePassUsed: false,
      rerankBackendUsed: retrieval.rerankBackendUsed,
      retrievalSettings,
      timings: {
        totalMs: elapsedMs(ragStarted),
        steps: timingSteps,
      },
    });
    if (sourceSummary) {
      meta.pickedSources = [
        {
          id: sourceSummary.id,
          slug: sourceSummary.slug,
          name: sourceSummary.name,
          faviconUrl: sourceSummary.faviconUrl ?? null,
          startUrl: sourceSummary.startUrl || null,
        },
      ];
    }

    requestContext?.set?.(LEDGEINDEX_RETRIEVAL_META_KEY, meta);

    logVerbose("RAG query processor finished", "RAGQuery", {
      sourceId,
      question,
      rewrittenQueries: queries,
      rewriteMethod,
      rewriteModelId,
      chunkCount: meta.chunks.length,
      insufficient,
      partial,
      answerMode: coverage.answerMode,
      coverageTier: coverage.coverageTier,
      coverageGraderUsed: coverage.coverageGraderUsed,
      catalogUrlFilter: retrieval.catalogUrlFilter?.applied
        ? retrieval.catalogUrlFilter.url
        : undefined,
      timings: meta.timings,
    });

    const retrievalInstruction = instructionForAnswerMode(
      coverage.answerMode,
      coverage.coverageReason
    );
    const multiPartInstruction = buildMultiPartAnswerInstruction(topicScope);

    const sourceBlock =
      coverage.answerMode === "none"
        ? ""
        : `\n\nRetrieved sources:\n${formatChunksForContext(agentChunks)}`;

    const systemParts = [
      retrievalInstruction,
      multiPartInstruction,
      sourceBlock,
    ]
      .map((part) => part.trim())
      .filter(Boolean);

    return {
      messages,
      systemMessages: [
        ...systemMessages,
        {
          role: "system" as const,
          content: systemParts.join("\n\n"),
        },
      ],
    };
  }
}
