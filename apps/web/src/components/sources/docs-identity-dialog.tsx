"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getProfileSiteRun,
  getSource,
  startProfileSiteRun,
  updateSourceCategories,
  updateSourceDocsIdentity,
  type DocsIdentity,
  type DocsIdentityKind,
  type DocsIdentityLanguage,
  type ProfileSeedCatalogPage,
  type ProfileSiteRun,
  type ProfileSiteRunProgress,
} from "@/lib/ledgeindex-api";
import {
  DOCS_IDENTITY_KIND_LABELS,
  DOCS_IDENTITY_LANGUAGE_LABELS,
} from "@/lib/source-metadata";
import {
  mergeSourceCategories,
  splitSourceCategories,
} from "@/lib/source-category-presets";
import { cn } from "@/lib/utils";

type PillStatus = "pending" | "running" | "done" | "error";

type MacroStepId = "crawl" | "pick" | "profile";

const KIND_OPTIONS = Object.keys(
  DOCS_IDENTITY_KIND_LABELS,
) as DocsIdentityKind[];
const LANGUAGE_OPTIONS = Object.keys(
  DOCS_IDENTITY_LANGUAGE_LABELS,
) as DocsIdentityLanguage[];

const CRAWL_MACRO_STEPS: Array<{ id: MacroStepId; label: string }> = [
  { id: "crawl", label: "Crawl" },
  { id: "pick", label: "Pick" },
  { id: "profile", label: "Profile" },
];

/** Builder / seeded catalog: pick → profile (no live crawl). */
const SEED_MACRO_STEPS: Array<{ id: MacroStepId; label: string }> = [
  { id: "pick", label: "Pick" },
  { id: "profile", label: "Profile" },
];

function pillClass(status: PillStatus, animate: boolean): string {
  const base =
    "relative min-w-0 truncate rounded-lg border px-2 py-1 font-mono text-[0.5rem] font-semibold tracking-[0.1em] uppercase shadow-card transition-colors sm:px-2.5 sm:text-[0.5625rem]";
  switch (status) {
    case "running":
      return cn(
        base,
        "border-sky-500/50 bg-sky-500/10 text-sky-700 dark:text-sky-300",
        animate && "pipeline-strip-shimmer",
      );
    case "done":
      return cn(
        base,
        "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
      );
    case "error":
      return cn(
        base,
        "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
      );
    default:
      return cn(base, "border-border bg-card-solid text-muted");
  }
}

function phaseToMacro(
  phase: ProfileSiteRunProgress["phase"] | undefined,
  skipCrawl: boolean,
): MacroStepId {
  if (skipCrawl) {
    if (!phase || phase === "crawl" || phase === "pick") return "pick";
    return "profile";
  }
  if (!phase || phase === "crawl") return "crawl";
  if (phase === "pick") return "pick";
  // fetch + synthesize = building the profile from picked context
  return "profile";
}

function macroStepStatus(
  stepId: MacroStepId,
  phase: ProfileSiteRunProgress["phase"] | undefined,
  runStatus: ProfileSiteRun["status"] | "idle",
  skipCrawl: boolean,
): PillStatus {
  const order: MacroStepId[] = skipCrawl
    ? ["pick", "profile"]
    : ["crawl", "pick", "profile"];
  if (runStatus === "failed") {
    const failedAt = phaseToMacro(phase, skipCrawl);
    const stepIdx = order.indexOf(stepId);
    const failIdx = order.indexOf(failedAt);
    if (stepIdx < failIdx) return "done";
    if (stepIdx === failIdx) return "error";
    return "pending";
  }
  if (runStatus === "completed") return "done";
  if (runStatus === "idle") return "pending";

  const stepIdx = order.indexOf(stepId);
  const phaseIdx = order.indexOf(phaseToMacro(phase, skipCrawl));
  if (phaseIdx > stepIdx) return "done";
  if (phaseIdx === stepIdx) return "running";
  return "pending";
}

function phaseDetail(
  progress: ProfileSiteRunProgress | undefined,
  skipCrawl: boolean,
): string | null {
  if (!progress) return null;
  switch (progress.phase) {
    case "crawl":
      return skipCrawl ? "Preparing pages…" : "Discovering site URLs…";
    case "pick":
      return "Picking pages as context…";
    case "fetch":
      return skipCrawl ? "Loading picked pages…" : "Fetching picked pages…";
    case "synthesize":
      return "Writing about…";
    default:
      return null;
  }
}

function ProfileProgressPills({
  progress,
  runStatus,
  animate,
  skipCrawl,
}: {
  progress?: ProfileSiteRunProgress;
  runStatus: ProfileSiteRun["status"] | "idle";
  animate: boolean;
  skipCrawl: boolean;
}) {
  const steps = skipCrawl ? SEED_MACRO_STEPS : CRAWL_MACRO_STEPS;
  const detail = phaseDetail(progress, skipCrawl);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div
        role="list"
        aria-label="Profile pipeline"
        className="flex min-w-0 flex-wrap items-center gap-1 sm:gap-1.5"
      >
        {steps.map((step, index) => {
          const status = macroStepStatus(
            step.id,
            progress?.phase,
            runStatus,
            skipCrawl,
          );
          return (
            <div
              key={step.id}
              className="flex min-w-0 items-center gap-1 sm:gap-1.5"
            >
              {index > 0 ? (
                <span className="text-[0.5rem] text-muted" aria-hidden>
                  →
                </span>
              ) : null}
              <div
                role="listitem"
                className={pillClass(status, animate && status === "running")}
                title={step.label}
              >
                {step.label}
              </div>
            </div>
          );
        })}
      </div>
      {detail && runStatus === "running" ? (
        <p className="m-0 truncate text-[0.6875rem] text-muted">{detail}</p>
      ) : null}
    </div>
  );
}

function descriptionFromLens(
  lens:
    | {
        overallSummary?: string;
        kind?: DocsIdentityKind;
        language?: DocsIdentityLanguage;
      }
    | undefined,
): string {
  return lens?.overallSummary?.trim() || "";
}

function badgeClassName(active = false): string {
  return cn(
    "inline-flex items-center rounded-full border px-2.5 py-1 font-mono text-[0.5rem] font-semibold tracking-[0.08em] uppercase",
    active
      ? "border-foreground/20 bg-foreground text-background"
      : "border-border bg-card-solid text-muted",
  );
}

export function docsIdentitySummaryText(
  identity?: DocsIdentity | null,
): string {
  if (!identity) return "";
  const summary = identity.overallSummary?.trim();
  if (summary) return summary;
  const pathDesc = identity.paths?.find((path) => path.description.trim())
    ?.description;
  return pathDesc?.trim() || "";
}

export function docsIdentityIsConfigured(
  identity?: DocsIdentity | null,
): boolean {
  return Boolean(docsIdentitySummaryText(identity));
}

export function DocsIdentityDialog({
  sourceId,
  startUrls,
  open,
  onOpenChange,
  onSaved,
  /** When set, skip crawl and run pick → profile on these pages. */
  seedPages,
  /** `panel` embeds as a side column (no modal overlay). */
  variant = "dialog",
  className,
}: {
  sourceId: string;
  startUrls: readonly string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (identity: DocsIdentity | null) => void;
  seedPages?: readonly ProfileSeedCatalogPage[];
  variant?: "dialog" | "panel";
  className?: string;
}) {
  const rootUrl = useMemo(
    () => startUrls.map((url) => url.trim()).find(Boolean) ?? "",
    [startUrls],
  );
  /** Explicit array (even empty) means seeded / no-crawl mode. */
  const skipCrawl = seedPages !== undefined;

  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<DocsIdentityKind | "">("");
  const [language, setLanguage] = useState<DocsIdentityLanguage | "">("");
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [runStatus, setRunStatus] = useState<ProfileSiteRun["status"] | "idle">(
    "idle",
  );
  const [progress, setProgress] = useState<ProfileSiteRunProgress | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { source } = await getSource(sourceId);
      const identity = source.sourceMetadata?.docsIdentity ?? null;
      const fromPath = identity?.paths?.find(
        (path) => path.url === (source.config.startUrls?.[0] ?? rootUrl),
      );
      const nextDescription =
        identity?.overallSummary?.trim() ||
        fromPath?.description?.trim() ||
        identity?.paths?.[0]?.description?.trim() ||
        "";
      setDescription(nextDescription);
      const fromIdentityKind = identity?.kind;
      const fromIdentityLanguage = identity?.language;
      const fromCategories = splitSourceCategories(source.categories ?? []);
      setKind(
        fromIdentityKind ||
          (fromCategories.kind as DocsIdentityKind | null) ||
          "",
      );
      setLanguage(
        fromIdentityLanguage ||
          (fromCategories.languages[0] as DocsIdentityLanguage | undefined) ||
          "",
      );
      setEditing(!nextDescription.trim());
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load docs identity",
      );
      setEditing(true);
    } finally {
      setLoading(false);
    }
  }, [sourceId, rootUrl]);

  useEffect(() => {
    if (!open) return;
    setRunStatus("idle");
    setProgress(undefined);
    setGenerating(false);
    void load();
  }, [open, load]);

  if (!open) return null;

  const hasAbout = Boolean(description.trim());
  const showView = hasAbout && !editing;

  function toPayload(nextDescription: string): DocsIdentity {
    const text = nextDescription.trim();
    return {
      overallSummary: text || undefined,
      kind: kind || undefined,
      language: language || undefined,
      paths: rootUrl
        ? [
            {
              url: rootUrl,
              description: text,
            },
          ]
        : [],
    };
  }

  async function syncCategoriesFromAbout(next: {
    kind?: DocsIdentityKind;
    language?: DocsIdentityLanguage;
  }) {
    try {
      const { source } = await getSource(sourceId);
      const parsed = splitSourceCategories(source.categories ?? []);
      const nextCategories = mergeSourceCategories({
        kind:
          next.kind && next.kind !== "uncategorized" ? next.kind : null,
        languages: next.language ? [next.language] : [],
        custom: parsed.custom,
      });
      await updateSourceCategories(sourceId, nextCategories);
    } catch {
      // About still saves even if category sync fails.
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSavedFlash(false);
    try {
      const { docsIdentity } = await updateSourceDocsIdentity(
        sourceId,
        toPayload(description),
      );
      setDescription(
        docsIdentity.overallSummary?.trim() ||
          docsIdentity.paths?.[0]?.description?.trim() ||
          "",
      );
      if (docsIdentity.kind) setKind(docsIdentity.kind);
      if (docsIdentity.language) setLanguage(docsIdentity.language);
      await syncCategoriesFromAbout({
        kind: docsIdentity.kind,
        language: docsIdentity.language,
      });
      onSaved?.(docsIdentity);
      setEditing(false);
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1600);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleGenerate() {
    if (!rootUrl) {
      setError("No start URL to profile");
      return;
    }
    if (skipCrawl && !seedPages?.length) {
      setError("No pages to pick from");
      return;
    }
    setGenerating(true);
    setError(null);
    setRunStatus("running");
    setProgress({ phase: skipCrawl ? "pick" : "crawl" });

    try {
      // Crawl sources: crawl → pick → fetch → synthesize.
      // Builder / seeded: pick → (seed markdown) → synthesize.
      const { run: started } = await startProfileSiteRun({
        url: rootUrl,
        lenses: ["docs_identity"],
        ...(skipCrawl
          ? {
              seedPages: seedPages!.map((page) => ({
                url: page.url,
                title: page.title,
                ...(page.markdown != null
                  ? { markdown: page.markdown.slice(0, 80_000) }
                  : {}),
              })),
            }
          : {
              maxPages: 80,
              sitemapOnly: true,
            }),
      });

      let attempt = 0;
      while (attempt < 90) {
        attempt += 1;
        await new Promise((resolve) => window.setTimeout(resolve, 2000));
        const { run } = await getProfileSiteRun(started.id);
        setProgress(run.progress);
        setRunStatus(run.status);

        if (run.status === "failed") {
          throw new Error(run.error || "Docs identity generation failed");
        }
        if (run.status !== "completed") continue;

        const lens = (
          run.profile as
            | {
                docs_identity?: {
                  overallSummary?: string;
                  kind?: DocsIdentityKind;
                  language?: DocsIdentityLanguage;
                };
              }
            | undefined
        )?.docs_identity;
        const nextDescription = descriptionFromLens(lens);
        if (!nextDescription) {
          throw new Error("Lens finished but returned no description");
        }

        if (lens?.kind) setKind(lens.kind);
        if (lens?.language) setLanguage(lens.language);

        const payload: DocsIdentity = {
          ...toPayload(nextDescription),
          kind: lens?.kind || kind || undefined,
          language: lens?.language || language || undefined,
          generatedAt: new Date().toISOString(),
        };

        const { docsIdentity } = await updateSourceDocsIdentity(
          sourceId,
          payload,
        );
        setDescription(
          docsIdentity.overallSummary?.trim() || nextDescription,
        );
        if (docsIdentity.kind) setKind(docsIdentity.kind);
        if (docsIdentity.language) setLanguage(docsIdentity.language);
        await syncCategoriesFromAbout({
          kind: docsIdentity.kind,
          language: docsIdentity.language,
        });
        setRunStatus("completed");
        onSaved?.(docsIdentity);
        setEditing(false);
        setSavedFlash(true);
        window.setTimeout(() => setSavedFlash(false), 1600);
        return;
      }
      throw new Error("Timed out waiting for docs identity lens");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
      setRunStatus("failed");
    } finally {
      setGenerating(false);
    }
  }

  const body = (
    <>
      <div className="shrink-0 border-b border-border px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">About</p>
            {rootUrl ? (
              <p className="mt-1.5 truncate font-mono text-[0.5625rem] text-muted">
                {rootUrl}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {showView ? (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="inline-flex h-7 items-center rounded-md border border-border bg-card-solid px-2 font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-muted uppercase transition-colors hover:border-foreground/15 hover:text-foreground"
              >
                Edit about
              </button>
            ) : null}
            {variant === "panel" ? (
              <button
                type="button"
                disabled={saving || generating}
                onClick={() => onOpenChange(false)}
                className="inline-flex h-7 shrink-0 items-center rounded-md border border-border px-2 font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-muted uppercase transition-colors hover:text-foreground disabled:opacity-50"
              >
                Close
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {loading ? (
          <p className="text-xs text-muted">Loading…</p>
        ) : showView ? (
          <>
            {kind || language ? (
              <div className="flex flex-wrap gap-1.5">
                {kind ? (
                  <span className={badgeClassName(true)}>
                    {DOCS_IDENTITY_KIND_LABELS[kind]}
                  </span>
                ) : null}
                {language ? (
                  <span
                    className={cn(
                      badgeClassName(false),
                      "border-accent/25 bg-accent/10 text-accent",
                    )}
                  >
                    {DOCS_IDENTITY_LANGUAGE_LABELS[language]}
                  </span>
                ) : null}
              </div>
            ) : null}
            <div>
              <p className="font-mono text-[0.5rem] font-semibold tracking-[0.1em] text-muted uppercase">
                About
              </p>
              <p className="mt-1.5 text-xs leading-relaxed text-foreground">
                {description}
              </p>
            </div>
          </>
        ) : (
          <>
            <div className="space-y-2">
              <p className="font-mono text-[0.5rem] font-semibold tracking-[0.1em] text-muted uppercase">
                Shelf
              </p>
              <div className="flex flex-wrap gap-1.5">
                {KIND_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    disabled={generating}
                    onClick={() => setKind(option)}
                    className={badgeClassName(kind === option)}
                  >
                    {DOCS_IDENTITY_KIND_LABELS[option]}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <p className="font-mono text-[0.5rem] font-semibold tracking-[0.1em] text-muted uppercase">
                Language
              </p>
              <div className="flex flex-wrap gap-1.5">
                {LANGUAGE_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    disabled={generating}
                    onClick={() => setLanguage(option)}
                    className={badgeClassName(language === option)}
                  >
                    {DOCS_IDENTITY_LANGUAGE_LABELS[option]}
                  </button>
                ))}
              </div>
            </div>

            <label className="block space-y-1.5">
              <span className="font-mono text-[0.5rem] font-semibold tracking-[0.1em] text-muted uppercase">
                Description
              </span>
              <textarea
                value={description}
                disabled={generating}
                onChange={(event) => setDescription(event.target.value)}
                rows={variant === "panel" ? 10 : 6}
                className="field-input w-full resize-y text-xs normal-case leading-5 disabled:opacity-60"
                placeholder="What this docs set covers…"
              />
            </label>
          </>
        )}

        {error ? (
          <p className="text-xs text-red-600 dark:text-red-300">{error}</p>
        ) : null}
      </div>

      {showView ? null : (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border px-3 py-2">
          <div className="min-w-0 flex-1">
            <ProfileProgressPills
              progress={progress}
              runStatus={runStatus}
              animate={generating}
              skipCrawl={skipCrawl}
            />
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {variant === "dialog" || hasAbout ? (
              <button
                type="button"
                disabled={saving || generating}
                onClick={() => {
                  if (hasAbout) setEditing(false);
                  else onOpenChange(false);
                }}
                className="inline-flex h-8 items-center justify-center rounded-lg border border-border px-3 text-xs font-medium text-muted transition-colors hover:text-foreground disabled:opacity-50"
              >
                {hasAbout ? "Cancel" : "Close"}
              </button>
            ) : null}
            <button
              type="button"
              disabled={
                loading ||
                generating ||
                !rootUrl ||
                (skipCrawl && !seedPages?.length)
              }
              onClick={() => void handleGenerate()}
              className="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-surface-raised px-3 text-xs font-medium text-foreground transition-colors hover:bg-card-solid disabled:cursor-not-allowed disabled:opacity-50"
            >
              {generating ? "Generating…" : "Generate"}
            </button>
            <button
              type="button"
              disabled={loading || saving || generating}
              onClick={() => void handleSave()}
              className="inline-flex h-8 items-center justify-center rounded-lg bg-foreground px-3 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Saving…" : savedFlash ? "Saved" : "Save"}
            </button>
          </div>
        </div>
      )}
    </>
  );

  if (variant === "panel") {
    return (
      <aside
        className={cn(
          "flex min-h-0 w-full shrink-0 flex-col border-border bg-surface-raised/40",
          "max-h-[48vh] border-t lg:max-h-none lg:w-[22rem] lg:border-t-0 lg:border-l xl:w-[26rem]",
          className,
        )}
        aria-label="About"
      >
        {body}
      </aside>
    );
  }

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/50"
        onClick={() => !saving && !generating && onOpenChange(false)}
      />
      <div
        className={cn(
          "relative z-[1] flex max-h-[min(32rem,90vh)] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-card-solid shadow-card",
          className,
        )}
        role="dialog"
        aria-label="About"
      >
        {body}
      </div>
    </div>
  );
}
