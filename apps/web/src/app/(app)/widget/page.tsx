"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Code2, Copy, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  KnowledgeIndexApiError,
  type SourceSummary,
} from "@/lib/ledgeindex-api";
import { syncWidgetCloudApi } from "@/lib/desktop-api-routing";
import {
  createWidgetIntegration,
  deleteWidgetIntegration,
  listSources,
  listWidgetIntegrations,
  resolveWidgetCloudApiBaseUrl,
  updateWidgetIntegration,
  widgetEmbedSnippet,
  type WidgetIntegrationSummary,
} from "@/lib/widget-api";
import {
  resolveWidgetSourceLabels,
  widgetSourceLabelsForRow,
  type WidgetSourceLabel,
} from "@/lib/widget-source-labels";
import { cn } from "@/lib/utils";

function isCloudBoundableSource(source: SourceSummary): boolean {
  return source.scope === "global" || source.hosting === "cloud";
}

function WidgetSourceDisplay({ labels }: { labels: WidgetSourceLabel[] }) {
  if (labels.length === 0) {
    return <span className="font-medium text-foreground">No source linked</span>;
  }

  return (
    <span className="inline-flex flex-col gap-0.5">
      {labels.map((label) => (
        <span key={label.id}>
          <span className="font-medium text-foreground">
            {label.scope === "global" ? `${label.name} (public)` : label.name}
          </span>
          {label.startUrl ? (
            <span className="mt-0.5 block font-mono text-[0.6875rem] font-normal text-muted">
              {label.startUrl}
            </span>
          ) : label.name === "Unknown source" ? (
            <span className="mt-0.5 block font-mono text-[0.6875rem] font-normal text-muted">
              {label.id}
            </span>
          ) : null}
        </span>
      ))}
    </span>
  );
}

/** Normalize to origin (scheme + host + port). Returns null if invalid. */
function parseOriginInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const withScheme = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function OriginsEditor({
  origins,
  onChange,
  disabled,
  draftId,
  onDraftChange,
}: {
  origins: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  draftId: string;
  onDraftChange?: (draft: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  function addOrigin() {
    const origin = parseOriginInput(draft);
    if (!origin) {
      setLocalError("Enter a full origin, e.g. https://docs.yoursite.com");
      return;
    }
    if (origins.includes(origin)) {
      setLocalError("Already added");
      return;
    }
    setLocalError(null);
    onChange([...origins, origin]);
    setDraft("");
  }

  return (
    <div className="grid gap-2">
      <span className="text-xs text-muted">Your website origins</span>
      {origins.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {origins.map((origin) => (
            <li
              key={origin}
              className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5"
            >
              <span className="min-w-0 flex-1 truncate font-mono text-[0.75rem] text-foreground">
                {origin}
              </span>
              <button
                type="button"
                disabled={disabled}
                aria-label={`Remove ${origin}`}
                className="shrink-0 rounded p-0.5 text-muted hover:bg-surface-raised hover:text-foreground disabled:opacity-50"
                onClick={() => onChange(origins.filter((o) => o !== origin))}
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[0.6875rem] text-muted">
          No origins yet — add the site that will embed the widget.
        </p>
      )}
      <div className="flex gap-2">
        <input
          id={`origin-draft-${draftId}`}
          className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-3 font-mono text-sm text-foreground"
          value={draft}
          disabled={disabled}
          placeholder="https://docs.yoursite.com"
          onChange={(e) => {
            setDraft(e.target.value);
            onDraftChange?.(e.target.value);
            if (localError) setLocalError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addOrigin();
            }
          }}
        />
        <Button
          type="button"
          variant="secondary"
          className="h-9 shrink-0 gap-1 px-3 text-xs"
          disabled={disabled || !draft.trim()}
          onClick={addOrigin}
        >
          <Plus className="size-3.5" />
          Add
        </Button>
      </div>
      {localError ? (
        <p className="text-[0.6875rem] text-destructive">{localError}</p>
      ) : (
        <p className="text-[0.6875rem] leading-4 text-muted">
          One origin at a time (scheme + host). Path is ignored —{" "}
          <code className="rounded bg-surface-raised px-1">
            https://docs.yoursite.com/guides
          </code>{" "}
          →{" "}
          <code className="rounded bg-surface-raised px-1">
            https://docs.yoursite.com
          </code>
          .
        </p>
      )}
    </div>
  );
}

async function loadCloudSources(): Promise<SourceSummary[]> {
  syncWidgetCloudApi();
  const [personalRes, globalRes] = await Promise.all([
    listSources("personal").catch(() => ({ sources: [] as SourceSummary[] })),
    listSources("global").catch(() => ({ sources: [] as SourceSummary[] })),
  ]);
  const byId = new Map<string, SourceSummary>();
  for (const source of personalRes.sources) {
    byId.set(source.id, source);
    if (source.sourceFamilyId) {
      byId.set(source.sourceFamilyId, source);
    }
  }
  for (const source of globalRes.sources) {
    byId.set(source.id, source);
  }
  return [...byId.values()]
    .filter(isCloudBoundableSource)
    .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
}

export default function WebsiteWidgetPage() {
  const [widgets, setWidgets] = useState<WidgetIntegrationSummary[]>([]);
  const [sources, setSources] = useState<SourceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("Ask AI");
  const [sourceId, setSourceId] = useState("");
  const [createOrigins, setCreateOrigins] = useState<string[]>([]);
  const [createOriginDraft, setCreateOriginDraft] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [savingOriginsId, setSavingOriginsId] = useState<string | null>(null);
  const [editOrigins, setEditOrigins] = useState<Record<string, string[]>>({});
  const [sourceLabelsById, setSourceLabelsById] = useState<
    Record<string, WidgetSourceLabel>
  >({});

  const cloudApi = resolveWidgetCloudApiBaseUrl();

  const loadWidgets = useCallback(async (catalog: SourceSummary[]) => {
    syncWidgetCloudApi();
    const widgetRows = await listWidgetIntegrations();
    setWidgets(widgetRows);
    setEditOrigins(
      Object.fromEntries(
        widgetRows.map((row) => [row.websiteId, [...row.allowedOrigins]]),
      ),
    );
    const labels = await resolveWidgetSourceLabels(widgetRows, catalog);
    setSourceLabelsById(labels);
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      syncWidgetCloudApi();
      const cloudSources = await loadCloudSources();
      setSources(cloudSources);
      await loadWidgets(cloudSources);
      setSourceId((current) => {
        if (current && cloudSources.some((s) => s.id === current)) return current;
        return cloudSources[0]?.id ?? "";
      });
    } catch (err) {
      setError(
        err instanceof KnowledgeIndexApiError
          ? err.message
          : "Failed to load widgets",
      );
    } finally {
      setLoading(false);
    }
  }, [loadWidgets]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const pendingCreateOrigin = useMemo(
    () => parseOriginInput(createOriginDraft),
    [createOriginDraft],
  );

  const canCreateWidget = Boolean(
    sourceId && name.trim() && (createOrigins.length > 0 || pendingCreateOrigin),
  );

  async function handleCreate() {
    let origins = [...createOrigins];
    if (origins.length === 0 && pendingCreateOrigin) {
      origins = [pendingCreateOrigin];
      setCreateOrigins(origins);
      setCreateOriginDraft("");
    }
    if (origins.length === 0) {
      setError("Add at least one website origin (e.g. http://localhost:3000)");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      syncWidgetCloudApi();
      await createWidgetIntegration({
        name,
        sourceIds: [sourceId],
        allowedOrigins: origins,
        brand: {
          projectName: name,
          projectColor: "#6b5a3e",
          projectLogo: null,
        },
      });
      await loadWidgets(sources);
    } catch (err) {
      setError(
        err instanceof KnowledgeIndexApiError
          ? err.message
          : "Failed to create widget",
      );
    } finally {
      setCreating(false);
    }
  }

  async function handleSaveOrigins(websiteId: string) {
    const next = editOrigins[websiteId] ?? [];
    if (next.length === 0) {
      setError("Keep at least one website origin");
      return;
    }
    setSavingOriginsId(websiteId);
    setError(null);
    try {
      syncWidgetCloudApi();
      await updateWidgetIntegration(websiteId, { allowedOrigins: next });
      await loadWidgets(sources);
    } catch (err) {
      setError(
        err instanceof KnowledgeIndexApiError
          ? err.message
          : "Failed to update origins",
      );
    } finally {
      setSavingOriginsId(null);
    }
  }

  async function handleDelete(websiteId: string) {
    setError(null);
    try {
      syncWidgetCloudApi();
      await deleteWidgetIntegration(websiteId);
      await loadWidgets(sources);
    } catch (err) {
      setError(
        err instanceof KnowledgeIndexApiError
          ? err.message
          : "Failed to delete widget",
      );
    }
  }

  async function copySnippet(row: WidgetIntegrationSummary) {
    const snippet = widgetEmbedSnippet(row.websiteId, row.brand);
    await navigator.clipboard.writeText(snippet);
    setCopiedId(row.websiteId);
    window.setTimeout(() => setCopiedId(null), 1500);
  }

  function originsDirty(row: WidgetIntegrationSummary): boolean {
    const draft = editOrigins[row.websiteId] ?? row.allowedOrigins;
    if (draft.length !== row.allowedOrigins.length) return true;
    return draft.some((o, i) => o !== row.allowedOrigins[i]);
  }

  const emptySourcesMessage = useMemo(() => {
    if (loading) return "Loading sources…";
    return "No cloud sources — index docs with Cloud hosting, or pick a public catalog source";
  }, [loading]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div
        aria-hidden
        className="section-glow-cool pointer-events-none absolute inset-0"
      />

      <div className="relative mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 pb-16 sm:px-6 sm:py-8">
        <header>
          <p className="font-mono text-[0.625rem] font-semibold tracking-[0.14em] text-muted uppercase">
            Website widget
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
            Embed Ask AI on your site
          </h1>
          <p className="mt-2 text-sm text-muted">
            Cloud-hosted widget for production sites. Bind a cloud-indexed source
            (yours or public), allowlist your origins, paste the snippet. Local-only
            sources are not supported yet.
          </p>
          <p className="mt-1 font-mono text-[0.6875rem] text-muted">
            API: {cloudApi}
          </p>
        </header>

        {error ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        <section className="rounded-2xl border border-border bg-card-solid p-4 shadow-card sm:p-5">
          <h2 className="text-sm font-semibold text-foreground">Create widget</h2>
          <div className="mt-3 grid gap-3">
            <label className="grid gap-1 text-xs text-muted">
              Name
              <input
                className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>

            <label className="grid gap-1 text-xs text-muted">
              Cloud source
              <select
                className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
                value={sourceId}
                onChange={(e) => setSourceId(e.target.value)}
                disabled={loading || sources.length === 0}
              >
                {sources.length === 0 ? (
                  <option value="">{emptySourcesMessage}</option>
                ) : (
                  sources.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.scope === "global"
                        ? `${s.name || s.id} (public)`
                        : s.name || s.id}
                    </option>
                  ))
                )}
              </select>
              <span className="text-[0.6875rem] leading-4 text-muted">
                Your cloud crawl or a public catalog source. Answers are served from{" "}
                {cloudApi}.
              </span>
            </label>

            <OriginsEditor
              draftId="create"
              origins={createOrigins}
              onChange={setCreateOrigins}
              onDraftChange={setCreateOriginDraft}
              disabled={creating}
            />

            <Button
              type="button"
              disabled={creating || !canCreateWidget}
              onClick={() => void handleCreate()}
            >
              {creating ? "Creating…" : "Create widget"}
            </Button>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Your widgets</h2>
          {loading ? (
            <p className="text-sm text-muted">Loading…</p>
          ) : widgets.length === 0 ? (
            <p className="text-sm text-muted">No widgets yet.</p>
          ) : (
            widgets.map((row) => {
              const draft = editOrigins[row.websiteId] ?? row.allowedOrigins;
              const dirty = originsDirty(row);
              return (
                <article
                  key={row.websiteId}
                  className="rounded-2xl border border-border bg-card-solid p-4 shadow-card"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold text-foreground">
                        {row.name}
                      </h3>
                      <p className="mt-1 text-sm text-muted">
                        Source:{" "}
                        <WidgetSourceDisplay
                          labels={widgetSourceLabelsForRow(row, sourceLabelsById)}
                        />
                      </p>
                      <p className="mt-1 font-mono text-[0.6875rem] text-muted">
                        {row.websiteId}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        className="h-8 gap-1.5 px-2.5 text-xs"
                        onClick={() => void copySnippet(row)}
                      >
                        <Copy className="size-3.5" />
                        {copiedId === row.websiteId ? "Copied" : "Copy snippet"}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        className="h-8 gap-1.5 px-2.5 text-xs"
                        onClick={() => void handleDelete(row.websiteId)}
                      >
                        <Trash2 className="size-3.5" />
                        Delete
                      </Button>
                    </div>
                  </div>

                  <div className="mt-3">
                    <OriginsEditor
                      draftId={row.websiteId}
                      origins={draft}
                      disabled={savingOriginsId === row.websiteId}
                      onChange={(next) =>
                        setEditOrigins((prev) => ({
                          ...prev,
                          [row.websiteId]: next,
                        }))
                      }
                    />
                    {dirty ? (
                      <Button
                        type="button"
                        className="mt-2 h-8 px-3 text-xs"
                        disabled={savingOriginsId === row.websiteId}
                        onClick={() => void handleSaveOrigins(row.websiteId)}
                      >
                        {savingOriginsId === row.websiteId
                          ? "Saving…"
                          : "Save origins"}
                      </Button>
                    ) : null}
                  </div>

                  <pre
                    className={cn(
                      "mt-3 overflow-x-auto rounded-lg border border-border bg-background p-3",
                      "font-mono text-[0.6875rem] leading-5 text-muted-strong",
                    )}
                  >
                    {widgetEmbedSnippet(row.websiteId, row.brand)}
                  </pre>
                </article>
              );
            })
          )}
        </section>

        <p className="flex items-start gap-2 text-xs text-muted">
          <Code2 className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Script loads from LedgeIndex CDN. Chat goes to{" "}
            <code className="rounded bg-surface-raised px-1">{cloudApi}</code>.
          </span>
        </p>
      </div>
    </div>
  );
}
