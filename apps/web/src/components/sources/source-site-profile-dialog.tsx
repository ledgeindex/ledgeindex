"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  deleteSourceSiteProfile,
  getProfileSiteRun,
  getSource,
  KnowledgeIndexApiError,
  normalizeStartUrl,
  startProfileSiteRun,
  updateSourceSiteProfile,
  type ProfileSiteRun,
  type ProfileSiteRunProgress,
  type SiteProfile,
  type SourceSummary,
} from "@/lib/ledgeindex-api";
import {
  DEFAULT_SITE_PROFILE_LENS_IDS,
  FULL_SITE_PROFILE_LENS_IDS,
  SITE_PROFILE_LENS_GROUPS,
  getSiteProfileLensOption,
  isSiteProfileLensId,
  siteProfileLensLabel,
  type SiteProfileLensId,
} from "@/lib/site-profile-lenses";
import { cn } from "@/lib/utils";

type Mode = "configure" | "running" | "view";

type PillStatus = "pending" | "running" | "done" | "error";

const PRESETS: Array<{
  id: string;
  label: string;
  lenses: SiteProfileLensId[];
}> = [
  { id: "default", label: "Default", lenses: DEFAULT_SITE_PROFILE_LENS_IDS },
  { id: "full", label: "Full profile", lenses: FULL_SITE_PROFILE_LENS_IDS },
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

function progressDetail(progress?: ProfileSiteRunProgress): string | null {
  if (!progress) return null;
  const lens = progress.lens ? siteProfileLensLabel(progress.lens) : null;
  switch (progress.phase) {
    case "crawl":
      return "Discovering site URLs…";
    case "pick":
      return lens ? `Picking pages · ${lens}` : "Picking pages…";
    case "fetch":
      return lens ? `Fetching context · ${lens}` : "Fetching pages…";
    case "synthesize":
      return lens ? `Writing · ${lens}` : "Synthesizing profile…";
    default:
      return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function CitationLink({ url }: { url: string }) {
  let host = url;
  try {
    host = new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    // keep raw
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex max-w-full items-center gap-1 font-mono text-[0.5625rem] text-muted hover:text-foreground"
    >
      <span className="truncate">{host}</span>
      <ExternalLink className="size-2.5 shrink-0" aria-hidden />
    </a>
  );
}

function ProfileValue({
  value,
  editable = false,
  busy = false,
  onChange,
}: {
  value: unknown;
  editable?: boolean;
  busy?: boolean;
  onChange?: (next: unknown) => void;
}) {
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return <p className="text-sm leading-6 text-foreground">{String(value)}</p>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    if (value.every((item) => typeof item === "string")) {
      return (
        <div className="flex flex-wrap gap-1">
          {value.map((item, index) => (
            <span
              key={`${item}-${index}`}
              className="inline-flex items-center gap-1 rounded border border-border bg-surface-raised px-1.5 py-0.5 font-mono text-[0.5625rem] text-muted-strong"
            >
              {item}
              {editable && onChange ? (
                <button
                  type="button"
                  disabled={busy}
                  aria-label={`Remove ${item}`}
                  onClick={() => onChange(value.filter((_, i) => i !== index))}
                  className="rounded p-0.5 text-muted hover:bg-surface-raised hover:text-red-600 disabled:opacity-50"
                >
                  <X className="size-2.5" aria-hidden />
                </button>
              ) : null}
            </span>
          ))}
        </div>
      );
    }
    return (
      <div className="space-y-2">
        {value.map((item, index) => {
          const row = asRecord(item);
          if (!row) {
            return (
              <div
                key={index}
                className="flex items-start justify-between gap-2"
              >
                <p className="text-sm text-foreground">{String(item)}</p>
                {editable && onChange ? (
                  <button
                    type="button"
                    disabled={busy}
                    aria-label="Remove item"
                    onClick={() => onChange(value.filter((_, i) => i !== index))}
                    className="shrink-0 rounded p-1 text-muted hover:bg-surface-raised hover:text-red-600 disabled:opacity-50"
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                ) : null}
              </div>
            );
          }
          const title =
            (typeof row.name === "string" && row.name) ||
            (typeof row.title === "string" && row.title) ||
            (typeof row.claim === "string" && row.claim) ||
            `Item ${index + 1}`;
          const description =
            (typeof row.description === "string" && row.description) ||
            (typeof row.oneLiner === "string" && row.oneLiner) ||
            null;
          const priority =
            typeof row.priority === "string" ? row.priority : null;
          const citation = asRecord(row.citation);
          const citationUrl =
            citation && typeof citation.url === "string" ? citation.url : null;
          return (
            <div
              key={`${title}-${index}`}
              className="rounded-lg border border-border bg-card-solid px-3 py-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="text-sm font-medium text-foreground">{title}</p>
                    {priority ? (
                      <span className="rounded border border-border bg-surface-raised px-1.5 py-px font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-muted uppercase">
                        {priority}
                      </span>
                    ) : null}
                  </div>
                  {description ? (
                    <p className="mt-1 text-xs leading-5 text-muted">
                      {description}
                    </p>
                  ) : null}
                  {citationUrl ? (
                    <div className="mt-1.5">
                      <CitationLink url={citationUrl} />
                    </div>
                  ) : null}
                </div>
                {editable && onChange ? (
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={`Remove ${title}`}
                    onClick={() => onChange(value.filter((_, i) => i !== index))}
                    className="shrink-0 rounded p-1 text-muted hover:bg-surface-raised hover:text-red-600 disabled:opacity-50"
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    );
  }
  const record = asRecord(value);
  if (!record) {
    return (
      <pre className="overflow-x-auto rounded-lg border border-border bg-card-solid p-2 font-mono text-[0.625rem] text-muted">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }
  return (
    <dl className="space-y-2">
      {Object.entries(record).map(([key, nested]) => {
        if (key === "citations" || nested == null) return null;
        if (Array.isArray(nested) && nested.length === 0) return null;
        return (
          <div key={key}>
            <dt className="font-mono text-[0.5rem] font-semibold tracking-[0.1em] text-muted uppercase">
              {key}
            </dt>
            <dd className="mt-0.5">
              <ProfileValue
                value={nested}
                editable={editable}
                busy={busy}
                onChange={
                  onChange
                    ? (next) => {
                        const updated = { ...record, [key]: next };
                        if (Array.isArray(next) && next.length === 0) {
                          delete updated[key];
                        }
                        onChange(updated);
                      }
                    : undefined
                }
              />
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function LensResultCard({
  lensId,
  data,
  busy = false,
  onRemoveLens,
  onChangeData,
}: {
  lensId: string;
  data: unknown;
  busy?: boolean;
  onRemoveLens?: () => void;
  onChangeData?: (next: unknown) => void;
}) {
  const record = asRecord(data);
  if (!record) return null;
  return (
    <section className="rounded-xl border border-border bg-surface-raised/50 p-3 sm:p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-mono text-[0.5625rem] font-semibold tracking-[0.12em] text-muted uppercase">
          {siteProfileLensLabel(lensId)}
        </h3>
        {onRemoveLens ? (
          <button
            type="button"
            disabled={busy}
            onClick={onRemoveLens}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-muted uppercase hover:bg-surface-raised hover:text-red-600 disabled:opacity-50"
          >
            <Trash2 className="size-3" aria-hidden />
            Remove lens
          </button>
        ) : null}
      </div>
      <div className="mt-3">
        <ProfileValue
          value={record}
          editable={Boolean(onChangeData)}
          busy={busy}
          onChange={onChangeData}
        />
      </div>
    </section>
  );
}

export function SourceSiteProfileDialog({
  open,
  onOpenChange,
  source,
  initialMode = "configure",
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: SourceSummary;
  initialMode?: Mode;
  onSaved?: (payload: {
    hasSiteProfile: boolean;
    siteProfileLensCount: number;
  }) => void;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [selected, setSelected] = useState<Set<SiteProfileLensId>>(
    () => new Set(DEFAULT_SITE_PROFILE_LENS_IDS),
  );
  const [sitemapOnly, setSitemapOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<ProfileSiteRun["status"] | "idle">(
    "idle",
  );
  const [progress, setProgress] = useState<ProfileSiteRunProgress | undefined>();
  const [siteProfile, setSiteProfile] = useState<SiteProfile | null>(null);
  const [loadingExisting, setLoadingExisting] = useState(false);

  const rootUrl = useMemo(
    () => normalizeStartUrl(source.startUrl || source.startUrls?.[0] || ""),
    [source.startUrl, source.startUrls],
  );

  const resetRun = useCallback(() => {
    setBusy(false);
    setError(null);
    setRunStatus("idle");
    setProgress(undefined);
  }, []);

  useEffect(() => {
    if (!open) return;
    setMode(initialMode);
    setSelected(new Set(DEFAULT_SITE_PROFILE_LENS_IDS));
    setSitemapOnly(false);
    resetRun();
    setSiteProfile(null);

    let cancelled = false;
    setLoadingExisting(true);
    void getSource(source.id)
      .then(({ source: full }) => {
        if (cancelled) return;
        const existing = full.sourceMetadata?.siteProfile ?? null;
        setSiteProfile(existing);
        if (existing?.lenses?.length) {
          const next = new Set<SiteProfileLensId>();
          for (const id of existing.lenses) {
            if (isSiteProfileLensId(id)) next.add(id);
          }
          if (next.size > 0) setSelected(next);
          if (initialMode === "view") setMode("view");
        } else if (initialMode === "view") {
          setMode("configure");
        }
      })
      .catch(() => {
        if (!cancelled && initialMode === "view") setMode("configure");
      })
      .finally(() => {
        if (!cancelled) setLoadingExisting(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, source.id, initialMode, resetRun]);

  function toggleLens(id: SiteProfileLensId) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function setGroupSelected(lensIds: SiteProfileLensId[], select: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      for (const id of lensIds) {
        if (select) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  async function persistProfile(next: SiteProfile | null) {
    setBusy(true);
    setError(null);
    try {
      if (!next || next.lenses.length === 0) {
        await deleteSourceSiteProfile(source.id);
        setSiteProfile(null);
        onSaved?.({ hasSiteProfile: false, siteProfileLensCount: 0 });
        setMode("configure");
        return;
      }
      const saved: SiteProfile = {
        ...next,
        updatedAt: new Date().toISOString(),
      };
      await updateSourceSiteProfile(source.id, saved);
      setSiteProfile(saved);
      onSaved?.({
        hasSiteProfile: true,
        siteProfileLensCount: saved.lenses.length,
      });
    } catch (err) {
      setError(
        err instanceof KnowledgeIndexApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Could not update profile",
      );
    } finally {
      setBusy(false);
    }
  }

  async function removeLens(lensId: string) {
    if (!siteProfile || busy) return;
    const label = siteProfileLensLabel(lensId);
    if (!window.confirm(`Remove “${label}” from this profile?`)) return;
    const lenses = siteProfile.lenses.filter((id) => id !== lensId);
    const profile = { ...(siteProfile.profile ?? {}) };
    delete profile[lensId];
    const lensSources = siteProfile.lensSources
      ? { ...siteProfile.lensSources }
      : undefined;
    if (lensSources) delete lensSources[lensId];
    await persistProfile({
      ...siteProfile,
      lenses,
      profile,
      lensSources,
    });
  }

  async function updateLensData(lensId: string, data: unknown) {
    if (!siteProfile || busy) return;
    await persistProfile({
      ...siteProfile,
      profile: {
        ...(siteProfile.profile ?? {}),
        [lensId]: data,
      },
    });
  }

  async function deleteProfile() {
    if (!siteProfile || busy) return;
    if (!window.confirm("Delete this entire site profile?")) return;
    await persistProfile(null);
  }

  async function runProfile() {
    if (!rootUrl || selected.size === 0 || busy) return;
    setBusy(true);
    setError(null);
    setMode("running");
    setRunStatus("running");
    setProgress({ phase: "crawl" });

    try {
      const lenses = [...selected];
      const { run: started } = await startProfileSiteRun({
        url: rootUrl,
        lenses,
        sitemapOnly,
      });

      const deadline = Date.now() + 12 * 60_000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => window.setTimeout(resolve, 900));
        const { run } = await getProfileSiteRun(started.id);
        setProgress(run.progress);
        setRunStatus(run.status);

        if (run.status === "failed") {
          throw new Error(run.error || "Profile run failed");
        }
        if (run.status === "completed") {
          const profile = (run.profile ?? {}) as Record<string, unknown>;
          const saved: SiteProfile = {
            rootUrl: run.rootUrl || rootUrl,
            lenses: run.lenses?.length ? run.lenses : lenses,
            profile,
            lensSources: run.lensSources,
            generatedAt: new Date().toISOString(),
            runId: run.id,
          };
          await updateSourceSiteProfile(source.id, saved);
          setSiteProfile(saved);
          setMode("view");
          onSaved?.({
            hasSiteProfile: true,
            siteProfileLensCount: saved.lenses.length,
          });
          return;
        }
      }
      throw new Error("Timed out waiting for profile run");
    } catch (err) {
      setRunStatus("failed");
      setMode("configure");
      setError(
        err instanceof KnowledgeIndexApiError
          ? err.status === 404
            ? "Could not save profile to this source (not found). Restart the API if you just pulled this feature, then try again."
            : err.message
          : err instanceof Error
            ? err.message
            : "Profile failed",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  const detail = progressDetail(progress);
  const activeLens = progress?.lens;
  const lensOrder =
    siteProfile?.lenses ??
    (selected.size > 0 ? [...selected] : DEFAULT_SITE_PROFILE_LENS_IDS);

  const panel = (
    <div
      className="fixed inset-0 z-[220] flex items-end justify-center bg-black/40 p-3 sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onOpenChange(false);
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Source profile"
        className={cn(
          "flex w-full flex-col overflow-hidden rounded-2xl border border-border bg-card-solid shadow-card",
          mode === "view"
            ? "max-h-[min(52rem,calc(100dvh-1.5rem))] max-w-4xl"
            : "max-h-[min(40rem,calc(100dvh-1.5rem))] max-w-xl",
        )}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <p className="font-mono text-[0.5625rem] font-semibold tracking-[0.12em] text-muted uppercase">
              Profile
            </p>
            <h2 className="mt-1 truncate text-sm font-semibold text-foreground">
              {source.name}
            </h2>
            {rootUrl ? (
              <p className="mt-1 truncate font-mono text-[0.5625rem] text-muted">
                {rootUrl}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => onOpenChange(false)}
            className="inline-flex size-8 items-center justify-center rounded-lg border border-border text-muted transition-colors hover:text-foreground disabled:opacity-50"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
          {error ? (
            <div className="rounded-xl border border-red-500/25 bg-red-500/8 px-3 py-2 text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
          ) : null}

          {mode === "running" ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-1.5">
                {(["crawl", "pick", "fetch", "synthesize"] as const).map(
                  (phase) => {
                    const order = ["crawl", "pick", "fetch", "synthesize"];
                    const current = progress?.phase ?? "crawl";
                    const status: PillStatus =
                      runStatus === "failed" && current === phase
                        ? "error"
                        : runStatus === "completed" ||
                            order.indexOf(current) > order.indexOf(phase)
                          ? "done"
                          : current === phase
                            ? "running"
                            : "pending";
                    return (
                      <span
                        key={phase}
                        className={pillClass(status, status === "running")}
                      >
                        {phase}
                      </span>
                    );
                  },
                )}
              </div>
              {detail ? (
                <p className="text-sm text-muted">{detail}</p>
              ) : (
                <p className="text-sm text-muted">Starting profile run…</p>
              )}
              <div className="flex flex-wrap gap-1.5">
                {lensOrder.map((lensId) => {
                  const status: PillStatus =
                    runStatus === "completed"
                      ? "done"
                      : activeLens === lensId
                        ? "running"
                        : "pending";
                  return (
                    <span
                      key={lensId}
                      className={pillClass(status, status === "running")}
                    >
                      {siteProfileLensLabel(lensId)}
                    </span>
                  );
                })}
              </div>
            </div>
          ) : null}

          {mode === "configure" ? (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-1.5">
                {PRESETS.map((preset) => {
                  const active =
                    preset.lenses.length === selected.size &&
                    preset.lenses.every((id) => selected.has(id));
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      disabled={busy}
                      onClick={() => setSelected(new Set(preset.lenses))}
                      className={cn(
                        "rounded-md border px-2 py-1 font-mono text-[0.5625rem] font-semibold tracking-[0.08em] uppercase transition-colors",
                        active
                          ? "border-foreground/20 bg-foreground text-background"
                          : "border-border bg-surface-raised text-muted hover:text-foreground",
                      )}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>

              {SITE_PROFILE_LENS_GROUPS.map((group) => {
                const selectedCount = group.lensIds.filter((id) =>
                  selected.has(id),
                ).length;
                const allSelected = selectedCount === group.lensIds.length;
                return (
                  <section
                    key={group.id}
                    className="rounded-xl border border-border bg-surface-raised/50 p-3"
                  >
                    <div className="mb-2 flex items-start justify-between gap-2 border-b border-border/70 pb-2">
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold text-foreground">
                          {group.label}
                        </h3>
                        <p className="mt-0.5 text-xs text-muted">
                          {group.description}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          setGroupSelected(group.lensIds, !allSelected)
                        }
                        className="shrink-0 font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-muted uppercase hover:text-foreground"
                      >
                        {allSelected ? "Clear" : "All"}
                      </button>
                    </div>
                    <div className="space-y-1.5">
                      {group.lensIds.map((id) => {
                        const option = getSiteProfileLensOption(id);
                        const checked = selected.has(id);
                        return (
                          <label
                            key={id}
                            className={cn(
                              "flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-2 transition-colors",
                              checked
                                ? "border-foreground/15 bg-card-solid"
                                : "border-transparent hover:bg-card-solid/60",
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={busy}
                              onChange={() => toggleLens(id)}
                              className="mt-0.5"
                            />
                            <span className="min-w-0">
                              <span className="block text-sm font-medium text-foreground">
                                {option.label}
                              </span>
                              <span className="mt-0.5 block text-xs text-muted">
                                {option.description}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </section>
                );
              })}

              <label className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface-raised/50 px-3 py-2.5">
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground">
                    Sitemap only
                  </span>
                  <span className="mt-0.5 block text-xs text-muted">
                    Faster discovery from sitemap.xml
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={sitemapOnly}
                  disabled={busy}
                  onChange={(event) => setSitemapOnly(event.target.checked)}
                />
              </label>
            </div>
          ) : null}

          {mode === "view" ? (
            loadingExisting ? (
              <p className="text-sm text-muted">Loading profile…</p>
            ) : siteProfile ? (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-1.5">
                  {siteProfile.lenses.map((lensId) => (
                    <span
                      key={lensId}
                      className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-raised px-2 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-muted uppercase"
                    >
                      {siteProfileLensLabel(lensId)}
                      <button
                        type="button"
                        disabled={busy}
                        aria-label={`Remove ${siteProfileLensLabel(lensId)}`}
                        onClick={() => void removeLens(lensId)}
                        className="rounded p-0.5 hover:bg-card-solid hover:text-red-600 disabled:opacity-50"
                      >
                        <X className="size-2.5" aria-hidden />
                      </button>
                    </span>
                  ))}
                </div>
                {siteProfile.lenses.map((lensId) => (
                  <LensResultCard
                    key={lensId}
                    lensId={lensId}
                    data={siteProfile.profile?.[lensId]}
                    busy={busy}
                    onRemoveLens={() => void removeLens(lensId)}
                    onChangeData={(next) => void updateLensData(lensId, next)}
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted">
                No profile saved yet. Pick lenses and run a profile.
              </p>
            )
          ) : null}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-4 py-3 sm:px-5">
          {mode === "view" ? (
            <>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    resetRun();
                    setMode("configure");
                  }}
                  className="font-mono text-[0.5625rem] font-semibold tracking-[0.08em] text-muted uppercase hover:text-foreground disabled:opacity-50"
                >
                  Re-profile
                </button>
                {siteProfile ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void deleteProfile()}
                    className="font-mono text-[0.5625rem] font-semibold tracking-[0.08em] text-red-600 uppercase hover:text-red-700 disabled:opacity-50 dark:text-red-400"
                  >
                    Delete profile
                  </button>
                ) : null}
              </div>
              <Button type="button" disabled={busy} onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </>
          ) : mode === "running" ? (
            <p className="font-mono text-[0.5625rem] tracking-[0.08em] text-muted uppercase">
              Running…
            </p>
          ) : (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => onOpenChange(false)}
                className="font-mono text-[0.5625rem] font-semibold tracking-[0.08em] text-muted uppercase hover:text-foreground"
              >
                Cancel
              </button>
              <Button
                type="button"
                disabled={busy || selected.size === 0 || !rootUrl}
                onClick={() => void runProfile()}
              >
                {siteProfile ? "Run again" : "Run profile"}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(panel, document.body);
}
