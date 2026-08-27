"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { RetrievalMeta, CoverageLevel, RetrievalStrictness } from "@/lib/retrieval-meta";
import {
  assessCoverageLevel,
  assessHitCoverageLevel,
  meterRelevanceThreshold,
  meterThresholdNote,
  resolveMeterMeta,
  readRewrittenQueries,
} from "@/lib/retrieval-meta";

function countUniqueUrls(chunks: RetrievalMeta["chunks"]): number {
  return new Set(chunks.map((chunk) => chunk.url).filter(Boolean)).size;
}

function shortModelLabel(modelId: string): string {
  const slash = modelId.lastIndexOf("/");
  return slash >= 0 ? modelId.slice(slash + 1) : modelId;
}

function isExpandedChunk(chunk: RetrievalMeta["chunks"][number]): boolean {
  return chunk.retrievalKind === "expanded";
}

function chunkMeta(chunk: RetrievalMeta["chunks"][number]): string {
  const parts: string[] = [];
  // An expanded chunk's score is copied from its page anchor, so showing it as a
  // score would imply the reranker judged this text. It did not.
  if (isExpandedChunk(chunk)) {
    parts.push("page context");
  } else if (typeof chunk.score === "number" && Number.isFinite(chunk.score)) {
    parts.push(`score ${chunk.score.toFixed(2)}`);
  }
  if (chunk.section?.trim()) parts.push(chunk.section.trim());
  else if (chunk.category?.trim()) parts.push(chunk.category.trim());
  const textLen = chunk.text?.trim().length;
  if (textLen) parts.push(`${textLen.toLocaleString()} chars`);
  return parts.join(" · ");
}

function formatScore(score: number): string {
  return score.toFixed(2);
}

function shortUrlLabel(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

function filterLabel(attempt: RetrievalMeta["searchAttempts"][number]): string {
  const parts = ["sourceId"];
  if (attempt.filter?.urlPrefix) {
    parts.push(`path=${shortUrlLabel(attempt.filter.urlPrefix)}`);
  }
  if (attempt.filter?.url) {
    parts.push(`url=${shortUrlLabel(attempt.filter.url)}`);
  }
  if (attempt.filter?.category) {
    parts.push(`category=${attempt.filter.category}`);
  }
  if (attempt.filter?.section) {
    parts.push(`section=${attempt.filter.section}`);
  }
  return parts.join(" + ");
}

function rerankMissReason(
  attempt: RetrievalMeta["searchAttempts"][number],
  threshold: number,
): "below-threshold" | "path-filtered" {
  const rerank = attempt.rerankTopScores ?? [];
  if (
    rerank.length > 0 &&
    rerank[0] >= threshold &&
    attempt.filter?.urlPrefix
  ) {
    return "path-filtered";
  }
  return "below-threshold";
}

function attemptKindLabel(
  attempt: RetrievalMeta["searchAttempts"][number],
): string | null {
  if (attempt.attemptType === "catalog_url_fallback") {
    const score =
      typeof attempt.catalogMatchScore === "number"
        ? ` · catalog ${formatScore(attempt.catalogMatchScore)}`
        : "";
    return `catalog scoped retry${score}`;
  }
  return null;
}

function hitScoresLabel(
  attempt: RetrievalMeta["searchAttempts"][number],
  threshold: number,
): string {
  const scores = attempt.directHitScores ?? [];
  const rerank = attempt.rerankTopScores ?? [];
  const display = scores.length > 0 ? scores : rerank;
  if (display.length === 0) return "";

  const prefix =
    scores.length > 0
      ? "hit scores"
      : rerankMissReason(attempt, threshold) === "path-filtered"
        ? "best rerank (path filtered)"
        : "best rerank (below thr)";
  const formatted = display.map(formatScore).join(", ");
  const max = display[0];
  const top3 = display.slice(0, 3);
  const avgTop3 =
    top3.reduce((sum, score) => sum + score, 0) / top3.length;

  return `${prefix}: ${formatted} · max ${formatScore(max)} · avg top-3 ${formatScore(avgTop3)}`;
}

function attemptScoreSummary(
  attempt: RetrievalMeta["searchAttempts"][number],
  threshold: number,
): { max: number; avgTop3: number; belowThreshold: boolean } | null {
  const scores = attempt.directHitScores ?? [];
  if (scores.length > 0) {
    const top3 = scores.slice(0, 3);
    return {
      max: scores[0],
      avgTop3: top3.reduce((sum, score) => sum + score, 0) / top3.length,
      belowThreshold: false,
    };
  }

  const rerank = attempt.rerankTopScores ?? [];
  if (rerank.length === 0) return null;
  const top3 = rerank.slice(0, 3);
  return {
    max: rerank[0],
    avgTop3: top3.reduce((sum, score) => sum + score, 0) / top3.length,
    belowThreshold: rerankMissReason(attempt, threshold) === "below-threshold",
  };
}

function combinedScoreSummaryFromAttempts(
  attempts: RetrievalMeta["searchAttempts"],
): { max: number; avgTop3: number } | null {
  const flatScores = attempts
    .flatMap((attempt) =>
      (attempt.directHitScores?.length
        ? attempt.directHitScores
        : attempt.rerankTopScores) ?? [],
    )
    .sort((a, b) => b - a);

  if (flatScores.length === 0) return null;

  const top3 = flatScores.slice(0, 3);
  return {
    max: flatScores[0],
    avgTop3: top3.reduce((sum, score) => sum + score, 0) / top3.length,
  };
}

function scoreColor(score: number, threshold: number): string {
  if (score >= threshold + 0.15) {
    return "text-emerald-600 dark:text-emerald-400";
  }
  if (score >= threshold) {
    return "text-foreground";
  }
  return "text-amber-600 dark:text-amber-400";
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Visual 0–1 score range with threshold, avg, and max markers. */
function ScoreRangeMeter({
  threshold,
  maxScore,
  avgTop3,
  relaxed,
  belowThreshold,
  thresholdNote,
  label = "Score range",
  compact = false,
}: {
  threshold: number;
  maxScore?: number;
  avgTop3?: number;
  relaxed?: boolean;
  belowThreshold?: boolean;
  thresholdNote?: "relaxed" | "weak" | "balanced" | "permissive";
  /** e.g. "Combined (injected)" vs per-query "Score range". */
  label?: string;
  compact?: boolean;
}) {
  const t = clamp01(threshold);
  const max = typeof maxScore === "number" ? clamp01(maxScore) : null;
  const avg = typeof avgTop3 === "number" ? clamp01(avgTop3) : null;
  const fillTo = max ?? avg ?? t;
  const barClass = compact
    ? "relative h-1.5 w-full overflow-visible rounded-full bg-muted/35"
    : "relative h-2.5 w-full overflow-visible rounded-full bg-muted/35";

  return (
    <div className={cn("space-y-1", compact ? "mt-1" : "mt-1.5")}>
      <div className="flex items-center justify-between gap-2 text-[0.5625rem] text-muted">
        <span className="uppercase tracking-wide">
          {belowThreshold ? "Best rerank (below thr)" : label}
        </span>
        <span className="font-mono tabular-nums">
          thr {formatScore(t)}
          {thresholdNote ? ` (${thresholdNote})` : relaxed ? " (relaxed)" : ""}
          {avg != null ? ` · avg ${formatScore(avg)}` : ""}
          {max != null ? ` · max ${formatScore(max)}` : ""}
        </span>
      </div>

      <div
        className={barClass}
        role="img"
        aria-label={`${label}: threshold ${formatScore(t)}${
          avg != null ? `, average top 3 ${formatScore(avg)}` : ""
        }${max != null ? `, max ${formatScore(max)}` : ""}`}
      >
        {/* Below-threshold zone */}
        <div
          className="absolute inset-y-0 left-0 rounded-l-full bg-amber-500/20"
          style={{ width: `${t * 100}%` }}
        />
        {/* Above-threshold fill up to max */}
        {fillTo > t ? (
          <div
            className="absolute inset-y-0 rounded-r-full bg-emerald-500/35"
            style={{
              left: `${t * 100}%`,
              width: `${(fillTo - t) * 100}%`,
            }}
          />
        ) : null}

        {/* Threshold tick */}
        <div
          className={cn(
            "absolute top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/70",
            compact ? "h-2.5 w-px" : "h-3.5 w-0.5",
          )}
          style={{ left: `${t * 100}%` }}
          title={`Threshold ${formatScore(t)}`}
        />

        {/* Avg marker */}
        {avg != null ? (
          <div
            className={cn(
              "absolute top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 rounded-full border border-sky-700/40 bg-sky-500 shadow-sm dark:border-sky-300/40",
              compact ? "size-1.5" : "size-2",
            )}
            style={{ left: `${avg * 100}%` }}
            title={`Avg top-3 ${formatScore(avg)}`}
          />
        ) : null}

        {/* Max marker */}
        {max != null ? (
          <div
            className={cn(
              "absolute top-1/2 z-30 -translate-x-1/2 -translate-y-1/2 rounded-full border border-emerald-800/30 bg-emerald-500 shadow-sm dark:border-emerald-200/40",
              compact ? "size-2" : "size-2.5",
            )}
            style={{ left: `${max * 100}%` }}
            title={`Max ${formatScore(max)}`}
          />
        ) : null}
      </div>

      {compact ? null : (
        <div className="flex items-center justify-between font-mono text-[0.5rem] tabular-nums text-muted/80">
          <span>0</span>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-2 w-0.5 rounded-full bg-foreground/70" />
              thr
            </span>
            {avg != null ? (
              <span className="inline-flex items-center gap-1">
                <span className="inline-block size-1.5 rounded-full bg-sky-500" />
                avg
              </span>
            ) : null}
            {max != null ? (
              <span className="inline-flex items-center gap-1">
                <span className="inline-block size-1.5 rounded-full bg-emerald-500" />
                max
              </span>
            ) : null}
          </div>
          <span>1</span>
        </div>
      )}
    </div>
  );
}

function MetaBadge({
  children,
  variant = "neutral",
}: {
  children: ReactNode;
  variant?: "neutral" | "info" | "success" | "warning" | "danger";
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[0.5625rem] font-medium uppercase tracking-wide",
        variant === "neutral" && "bg-muted/30 text-muted",
        variant === "info" &&
          "bg-sky-500/15 text-sky-600 dark:text-sky-400",
        variant === "success" &&
          "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
        variant === "warning" &&
          "bg-amber-500/15 text-amber-600 dark:text-amber-400",
        variant === "danger" && "bg-red-500/15 text-red-600 dark:text-red-400",
      )}
    >
      {children}
    </span>
  );
}

function CoverageBadge({
  level,
  answerMode,
}: {
  level: CoverageLevel;
  answerMode?: RetrievalMeta["answerMode"];
}) {
  const label =
    answerMode === "full"
      ? "full coverage"
      : answerMode === "partial"
        ? "partial"
        : answerMode === "none"
          ? "none"
          : level === "high"
            ? "high confidence"
            : level === "partial"
              ? "partial"
              : "none";

  return (
    <MetaBadge
      variant={
        level === "high" ? "success" : level === "partial" ? "warning" : "danger"
      }
    >
      {label}
    </MetaBadge>
  );
}

function topicScopeBadgeLabel(
  scope?: RetrievalMeta["topicScope"],
): string | null {
  if (scope === "multi") return "multi-topic";
  if (scope === "single") return "single-topic";
  return null;
}

function tierBadgeLabel(tier?: RetrievalMeta["coverageTier"]): string | null {
  switch (tier) {
    case "tier0":
      return "tier 0";
    case "tier1_heuristic":
      return "tier 1";
    case "tier2_llm":
      return "tier 2";
    default:
      return null;
  }
}

function tierBadgeVariant(
  tier?: RetrievalMeta["coverageTier"],
): "neutral" | "info" | "success" | "warning" | "danger" {
  switch (tier) {
    case "tier2_llm":
      return "info";
    case "tier0":
      return "danger";
    default:
      return "neutral";
  }
}

function answerModeLabel(mode?: RetrievalMeta["answerMode"]): string {
  switch (mode) {
    case "full":
      return "full coverage";
    case "partial":
      return "partial coverage";
    case "none":
      return "no coverage";
    default:
      return "unknown";
  }
}

function coverageLevelFromAnswerMode(
  mode?: RetrievalMeta["answerMode"],
): CoverageLevel | null {
  switch (mode) {
    case "full":
      return "high";
    case "partial":
      return "partial";
    case "none":
      return "none";
    default:
      return null;
  }
}

function pipelineLabel(attempt: RetrievalMeta["searchAttempts"][number]): string {
  const { initialCount, rerankedCount, directHitCount, prunedCount } = attempt;
  if (
    typeof initialCount === "number" &&
    typeof rerankedCount === "number" &&
    typeof directHitCount === "number"
  ) {
    const expanded =
      typeof prunedCount === "number" && prunedCount > directHitCount
        ? ` → ${prunedCount} expanded`
        : "";
    return `${initialCount} vec → ${rerankedCount} rerank → ${directHitCount} hits${expanded}`;
  }
  return "";
}

function QueryChip({
  query,
  index,
  skipped,
  catalog,
}: {
  query: string;
  index: number;
  skipped?: boolean;
  catalog?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-baseline gap-1 rounded-md px-1.5 py-0.5 text-[0.625rem]",
        skipped
          ? "bg-muted/20 text-muted line-through"
          : catalog
            ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
            : "bg-muted/30 text-foreground",
      )}
    >
      <span
        className={cn(
          catalog && !skipped
            ? "text-amber-600/70 dark:text-amber-400/70"
            : "text-muted",
        )}
      >
        {index + 1}.
      </span>
      <span className="truncate font-mono">{query}</span>
    </span>
  );
}

function AttemptRow({
  attempt,
  index,
  total,
  threshold,
  thresholdNote,
}: {
  attempt: RetrievalMeta["searchAttempts"][number];
  index: number;
  total: number;
  threshold: number;
  thresholdNote?: "relaxed" | "weak" | "balanced" | "permissive";
}) {
  const [open, setOpen] = useState(false);
  const query = attempt.query?.trim() || `Query ${index + 1}`;
  const directHits = attempt.directHitCount ?? attempt.chunkCount ?? 0;
  const injected =
    typeof attempt.prunedCount === "number" ? attempt.prunedCount : directHits;
  const failed = attempt.insufficient ?? directHits === 0;
  const label = total === 1 ? "Q" : `Q${index + 1}`;
  const pipeline = pipelineLabel(attempt);
  const hitScores = hitScoresLabel(attempt, threshold);
  const scoreSummary = attemptScoreSummary(attempt, threshold);
  const filter = filterLabel(attempt);
  const kind = attemptKindLabel(attempt);
  const queryCoverage = assessHitCoverageLevel({
    directHitScores: attempt.directHitScores,
    insufficient: failed,
  });
  const queryAnswerMode =
    queryCoverage === "high"
      ? ("full" as const)
      : queryCoverage === "partial"
        ? ("partial" as const)
        : ("none" as const);
  const hasExtra = Boolean(pipeline || hitScores || filter !== "sourceId");

  return (
    <div className="rounded-md border border-border/35 bg-background/35 px-2 py-1.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="shrink-0 text-[0.5625rem] text-muted">
          {kind ?? label}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[0.625rem] text-foreground">
          {query}
        </span>
        <CoverageBadge level={queryCoverage} answerMode={queryAnswerMode} />
        <span
          className={cn(
            "shrink-0 text-[0.5625rem] tabular-nums",
            failed ? "text-amber-600 dark:text-amber-400" : "text-muted",
          )}
        >
          {failed
            ? "miss"
            : injected > directHits
              ? `${directHits}→${injected}`
              : `${injected}`}
        </span>
        {hasExtra ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="shrink-0 text-[0.5625rem] text-muted underline-offset-2 hover:text-foreground hover:underline"
            aria-expanded={open}
          >
            {open ? "less" : "more"}
          </button>
        ) : null}
      </div>

      {scoreSummary ? (
        <ScoreRangeMeter
          compact
          label="Score"
          threshold={threshold}
          maxScore={scoreSummary.max}
          avgTop3={scoreSummary.avgTop3}
          belowThreshold={scoreSummary.belowThreshold}
          thresholdNote={thresholdNote}
        />
      ) : null}

      {open && hasExtra ? (
        <div className="mt-1 space-y-0.5 border-t border-border/30 pt-1 font-mono text-[0.5625rem] text-muted">
          {filter !== "sourceId" ? <p>filter: {filter}</p> : null}
          {pipeline ? <p>{pipeline}</p> : null}
          {hitScores ? <p>{hitScores}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

export function isRetrievalPart(
  part: { type: string },
): part is { type: "data-retrieval"; data: RetrievalMeta } {
  return part.type === "data-retrieval";
}

export function parseRetrievalPart(
  part: { type: string; data?: unknown },
): RetrievalMeta | null {
  if (!isRetrievalPart(part)) return null;
  if (!part.data || typeof part.data !== "object") return null;
  return part.data as RetrievalMeta;
}

function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  return `${Math.round(seconds)}s`;
}

function TimingBreakdown({
  timings,
}: {
  timings: NonNullable<RetrievalMeta["timings"]>;
}) {
  const maxMs = Math.max(
    timings.totalMs,
    ...timings.steps.map((step) => step.ms),
    1,
  );

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-medium text-foreground">Retrieval timing</p>
        <p className="font-mono text-[0.625rem] tabular-nums text-foreground">
          {formatDurationMs(timings.totalMs)} total
        </p>
      </div>
      <ul className="space-y-1.5">
        {timings.steps.map((step) => {
          const widthPct = Math.max(2, Math.round((step.ms / maxMs) * 100));
          const isSubstep = step.id.includes("-embed") ||
            step.id.includes("-vector") ||
            step.id.includes("-rerank") ||
            step.id.includes("-expand");
          return (
            <li
              key={step.id}
              className={cn(isSubstep && "pl-3")}
              title={step.detail}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span
                  className={cn(
                    "min-w-0 truncate text-[0.625rem]",
                    isSubstep ? "text-muted" : "text-foreground/80",
                  )}
                >
                  {step.label}
                  {step.detail ? (
                    <span className="text-muted"> · {step.detail}</span>
                  ) : null}
                </span>
                <span className="shrink-0 font-mono text-[0.5625rem] tabular-nums text-muted">
                  {formatDurationMs(step.ms)}
                </span>
              </div>
              <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-border/50">
                <div
                  className={cn(
                    "h-full rounded-full",
                    isSubstep ? "bg-muted/55" : "bg-accent/70",
                  )}
                  style={{ width: `${widthPct}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function ChatRetrievalCard({
  meta,
  retrievalStrictness,
}: {
  meta: RetrievalMeta;
  /** Toolbar strictness when streamed meta omits retrievalStrictness. */
  retrievalStrictness?: RetrievalStrictness;
}) {
  const [expanded, setExpanded] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [timingOpen, setTimingOpen] = useState(false);
  const meterMeta = resolveMeterMeta(meta, retrievalStrictness);
  const rewrittenQueries = readRewrittenQueries(meta);
  const skippedSet = new Set(meta.skippedQueries ?? []);
  const catalogSet = new Set(
    (meta.catalogQueries ?? []).map((query) => query.trim().toLowerCase()),
  );
  const attempts = meta.searchAttempts ?? [];
  const chunks = meta.chunks ?? [];
  const timings = meta.timings;
  const sourceCount = countUniqueUrls(chunks);
  const canExpand = chunks.length > 0;
  const hasTiming = Boolean(timings && timings.steps.length > 0);
  const usedFallback = meta.rewriteMethod === "fallback";
  const usedCascade =
    meta.rewriteMethod === "cascade" || Boolean(meta.cascadePassUsed);
  const threshold = meterRelevanceThreshold(meterMeta);
  const thresholdNote = meterThresholdNote(meterMeta);
  const combinedRerank = combinedScoreSummaryFromAttempts(attempts);
  const displayMaxScore = meta.maxChunkScore ?? combinedRerank?.max;
  const displayAvgTop3 = meta.avgTop3Score ?? combinedRerank?.avgTop3;
  const hasScoreRange =
    typeof displayMaxScore === "number" || typeof displayAvgTop3 === "number";
  const scoreBelowThreshold =
    meta.insufficient && typeof meta.maxChunkScore !== "number" && combinedRerank;
  const coverageLevel =
    coverageLevelFromAnswerMode(meta.answerMode) ??
    assessCoverageLevel(meta);
  const topicBadge = topicScopeBadgeLabel(meta.topicScope);
  const tierBadge = tierBadgeLabel(meta.coverageTier);
  const rewriteLabel =
    meta.rewriteMethod === "llm"
      ? `llm${meta.rewriteModelId ? ` · ${shortModelLabel(meta.rewriteModelId)}` : ""}`
      : meta.rewriteMethod === "catalog"
        ? "catalog match"
        : usedCascade
          ? `cascade${
              typeof meta.cascadeTopScore === "number"
                ? ` · ${formatScore(meta.cascadeTopScore)}`
                : ""
            }`
          : usedFallback
            ? "fallback"
            : null;
  const graderLabel = meta.coverageGraderUsed
    ? meta.coverageModelId
      ? shortModelLabel(meta.coverageModelId)
      : "llm"
    : null;
  const hasDetails =
    rewrittenQueries.length > 0 ||
    attempts.length > 0 ||
    Boolean(meta.answerMode || meta.coverageTier || meta.coverageReason) ||
    (meta.droppedPages?.length ?? 0) > 0;
  const expandedCount = chunks.filter(isExpandedChunk).length;
  const rankedCount = chunks.length - expandedCount;
  const summaryBits = [
    timings ? formatDurationMs(timings.totalMs) : null,
    expandedCount > 0
      ? `${rankedCount} ranked + ${expandedCount} context`
      : `${chunks.length} chunk${chunks.length === 1 ? "" : "s"}`,
    sourceCount > 0
      ? `${sourceCount} page${sourceCount === 1 ? "" : "s"}`
      : null,
    attempts.length > 1 ? `${attempts.length} queries` : null,
    meta.rerankDeviceLabel ? meta.rerankDeviceLabel : null,
    (meta.droppedPages?.length ?? 0) > 0
      ? `dropped ${meta.droppedPages?.length}`
      : null,
    meta.insufficient ? "no valid sources" : null,
  ].filter(Boolean);

  return (
    <div className="w-full rounded-lg border border-border/60 bg-surface-raised/80 text-xs">
      <div className="px-3 py-2.5">
        <div className="flex items-start gap-2">
          <span
            className={cn(
              "mt-0.5 inline-flex size-3.5 shrink-0 items-center justify-center rounded-full text-[0.5rem]",
              meta.insufficient
                ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
            )}
            aria-hidden
          >
            {meta.insufficient ? "!" : "✓"}
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <p
                className="min-w-0 flex-1 truncate font-medium leading-snug text-foreground"
                title={meta.question?.trim() || undefined}
              >
                {meta.question?.trim() || "Retrieval"}
              </p>
              <div className="flex max-w-[45%] flex-wrap justify-end gap-1">
                {topicBadge ? (
                  <MetaBadge variant="neutral">{topicBadge}</MetaBadge>
                ) : null}
                <CoverageBadge
                  level={coverageLevel}
                  answerMode={meta.answerMode}
                />
              </div>
            </div>

            <p className="mt-1.5 text-[0.625rem] text-muted">
              {summaryBits.join(" · ")}
            </p>

            {hasScoreRange ? (
              <ScoreRangeMeter
                label={attempts.length > 1 ? "Combined" : "Score"}
                threshold={threshold}
                maxScore={displayMaxScore}
                avgTop3={displayAvgTop3}
                relaxed={Boolean(meta.relaxedPassUsed)}
                thresholdNote={thresholdNote}
                belowThreshold={Boolean(scoreBelowThreshold)}
              />
            ) : null}

            <div className="mt-2 flex flex-wrap items-center gap-2">
              {canExpand ? (
                <button
                  type="button"
                  onClick={() => setExpanded((open) => !open)}
                  className="text-[0.625rem] text-foreground/80 underline-offset-2 hover:underline"
                  aria-expanded={expanded}
                >
                  {expanded ? "Hide chunks" : "Show chunks"}
                </button>
              ) : null}
              {hasTiming ? (
                <button
                  type="button"
                  onClick={() => setTimingOpen((open) => !open)}
                  className="text-[0.625rem] text-foreground/80 underline-offset-2 hover:underline"
                  aria-expanded={timingOpen}
                >
                  {timingOpen ? "Hide timing" : "Show timing"}
                </button>
              ) : null}
              {hasDetails ? (
                <button
                  type="button"
                  onClick={() => setDetailsOpen((open) => !open)}
                  className="text-[0.625rem] text-muted underline-offset-2 hover:text-foreground hover:underline"
                  aria-expanded={detailsOpen}
                >
                  {detailsOpen ? "Hide retrieval details" : "Retrieval details"}
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {timingOpen && hasTiming && timings ? (
          <div className="mt-2 border-t border-border/40 pt-2">
            <TimingBreakdown timings={timings} />
          </div>
        ) : null}

        {detailsOpen && hasDetails ? (
          <div className="mt-2 space-y-2 border-t border-border/40 pt-2">
            <div className="flex flex-wrap gap-1">
              {meta.rerankDeviceLabel ? (
                <MetaBadge
                  variant={
                    meta.rerankDeviceLabel.startsWith("GPU")
                      ? "success"
                      : "neutral"
                  }
                >
                  rerank · {meta.rerankDeviceLabel}
                </MetaBadge>
              ) : null}
              {tierBadge ? (
                <MetaBadge variant={tierBadgeVariant(meta.coverageTier)}>
                  {tierBadge}
                </MetaBadge>
              ) : null}
              {attempts.length > 1 ? (
                <MetaBadge variant="neutral">combined verdict</MetaBadge>
              ) : null}
              {rewriteLabel ? (
                <MetaBadge variant="neutral">{rewriteLabel}</MetaBadge>
              ) : null}
              {meterMeta.retrievalStrictness ? (
                <MetaBadge variant="neutral">
                  {meterMeta.retrievalStrictness}
                </MetaBadge>
              ) : null}
              {meta.pageFilterUsed ? (
                <MetaBadge variant="info">page filter</MetaBadge>
              ) : null}
            </div>

            {rewrittenQueries.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {rewrittenQueries.map((query, index) => (
                  <QueryChip
                    key={`${query}-${index}`}
                    query={query}
                    index={index}
                    skipped={skippedSet.has(query)}
                    catalog={catalogSet.has(query.trim().toLowerCase())}
                  />
                ))}
              </div>
            ) : null}

            {attempts.length > 0 ? (
              <div className="space-y-1.5">
                {attempts.map((attempt, index) => (
                  <AttemptRow
                    key={`${attempt.query}-${index}`}
                    attempt={attempt}
                    index={index}
                    total={attempts.length}
                    threshold={threshold}
                    thresholdNote={thresholdNote}
                  />
                ))}
              </div>
            ) : null}

            {meta.droppedPages && meta.droppedPages.length > 0 ? (
              <ul className="space-y-1">
                {meta.droppedPages.map((page) => (
                  <li
                    key={page.url}
                    className="text-[0.625rem] text-muted"
                  >
                    <span className="text-amber-700 dark:text-amber-400">
                      dropped {page.title.trim() || shortUrlLabel(page.url)}
                    </span>
                    {page.reason ? ` · ${page.reason}` : ""}
                  </li>
                ))}
              </ul>
            ) : null}

            {meta.answerMode || meta.coverageTier || meta.coverageReason ? (
              <p className="text-[0.625rem] text-muted">
                <span className="text-foreground/70">
                  {attempts.length > 1 ? "Combined: " : "Coverage: "}
                </span>
                {answerModeLabel(meta.answerMode)}
                {graderLabel ? ` · grader ${graderLabel}` : " · no grader"}
                {meta.coverageReason ? ` · ${meta.coverageReason}` : ""}
              </p>
            ) : null}

            {meta.catalogUrlFilter?.applied ? (
              <p className="text-[0.5625rem] text-muted">
                {meta.catalogUrlFilter.succeeded
                  ? `Catalog filter ${formatScore(meta.catalogUrlFilter.score)} on ${shortUrlLabel(meta.catalogUrlFilter.url)}`
                  : `Catalog filter tried (${formatScore(meta.catalogUrlFilter.score)})`}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      {expanded && canExpand ? (
        <div className="space-y-2 border-t border-border/50 px-3 py-2.5">
          <ul className="space-y-2">
            {chunks.map((chunk, index) => {
              const metaLine = chunkMeta(chunk);
              return (
                <li
                  key={`${chunk.url}-${index}`}
                  className={cn(
                    "rounded-md border p-2",
                    isExpandedChunk(chunk)
                      ? "border-border/30 bg-background/30"
                      : "border-border/50 bg-background/60",
                  )}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                    <p className="font-medium text-foreground">
                      {chunk.title?.trim() ||
                        chunk.url ||
                        `Chunk ${index + 1}`}
                    </p>
                    {metaLine ? (
                      <p
                        className={cn(
                          "shrink-0 font-mono text-[0.5625rem]",
                          isExpandedChunk(chunk)
                            ? "text-muted"
                            : typeof chunk.score === "number"
                              ? scoreColor(chunk.score, threshold)
                              : "text-muted",
                        )}
                      >
                        {metaLine}
                      </p>
                    ) : null}
                  </div>
                  {chunk.url ? (
                    <a
                      href={chunk.url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 block truncate font-mono text-[0.625rem] text-accent hover:underline"
                    >
                      {chunk.url}
                    </a>
                  ) : null}
                  {chunk.text?.trim() ? (
                    <pre className="mt-1.5 max-h-80 overflow-auto whitespace-pre-wrap wrap-break-word rounded border border-border/40 bg-muted/20 p-2 font-mono text-[0.625rem] leading-relaxed text-foreground">
                      {chunk.text}
                    </pre>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
