"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Code2, Copy, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CloudLocalToggle } from "@/components/chat/cloud-local-toggle";
import {
  KnowledgeIndexApiError,
  listSources,
  type SourceSummary,
} from "@/lib/ledgeindex-api";
import { syncApiBaseForHosting } from "@/lib/desktop-api-routing";
import {
  createWidgetIntegration,
  deleteWidgetIntegration,
  listWidgetIntegrations,
  updateWidgetIntegration,
  widgetEmbedSnippet,
  type WidgetIntegrationSummary,
} from "@/lib/widget-api";
import { cn } from "@/lib/utils";

function isLocalSource(source: SourceSummary): boolean {
  if (source.scope === "global") return false;
  return source.hosting !== "cloud";
}

function isCloudBoundableSource(source: SourceSummary): boolean {
  return source.scope === "global" || source.hosting === "cloud";
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
}: {
  origins: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  /** Stable id prefix for input (create vs websiteId). */
  draftId: string;
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

export default function IntegrationsPage() {
  const [widgets, setWidgets] = useState<WidgetIntegrationSummary[]>([]);
  const [sources, setSources] = useState<SourceSummary[]>([]);
  const [hosting, setHosting] = useState<"local" | "cloud">("local");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("Ask AI");
  const [sourceId, setSourceId] = useState("");
  const [createOrigins, setCreateOrigins] = useState<string[]>([
    "http://localhost:3000",
  ]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [savingOriginsId, setSavingOriginsId] = useState<string | null>(null);
  /** Draft origins while editing an existing widget (keyed by websiteId). */
  const [editOrigins, setEditOrigins] = useState<Record<string, string[]>>({});

  const visibleSources = useMemo(() => {
    const filtered =
      hosting === "local"
        ? sources.filter(isLocalSource)
        : sources.filter(isCloudBoundableSource);
    return filtered.sort((a, b) =>
      (a.name || a.id).localeCompare(b.name || b.id),
    );
  }, [sources, hosting]);

  const loadWidgets = useCallback(async (forHosting: "local" | "cloud") => {
    syncApiBaseForHosting({
      scope: forHosting === "cloud" ? "global" : "personal",
      hosting: forHosting,
    });
    const widgetRows = await listWidgetIntegrations();
    setWidgets(widgetRows);
    setEditOrigins(
      Object.fromEntries(
        widgetRows.map((row) => [row.websiteId, [...row.allowedOrigins]]),
      ),
    );
  }, []);

  const loadSourcesForHosting = useCallback(async (next: "local" | "cloud") => {
    syncApiBaseForHosting({
      scope: next === "cloud" ? "global" : "personal",
      hosting: next,
    });

    if (next === "local") {
      const { sources: personal } = await listSources("personal");
      setSources(personal);
      const filtered = personal.filter(isLocalSource);
      setSourceId((current) => {
        if (current && filtered.some((s) => s.id === current)) return current;
        return filtered[0]?.id ?? "";
      });
      return;
    }

    const [personalRes, globalRes] = await Promise.all([
      listSources("personal").catch(() => ({ sources: [] as SourceSummary[] })),
      listSources("global").catch(() => ({ sources: [] as SourceSummary[] })),
    ]);
    const byId = new Map<string, SourceSummary>();
    for (const source of personalRes.sources) {
      if (source.hosting === "cloud") byId.set(source.id, source);
    }
    for (const source of globalRes.sources) {
      byId.set(source.id, source);
    }
    const merged = [...byId.values()];
    setSources(merged);
    setSourceId((current) => {
      if (current && merged.some((s) => s.id === current)) return current;
      return merged[0]?.id ?? "";
    });
  }, []);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([loadWidgets(hosting), loadSourcesForHosting(hosting)]);
    } catch (err) {
      setError(
        err instanceof KnowledgeIndexApiError
          ? err.message
          : "Failed to load integrations",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleHostingChange(next: "local" | "cloud") {
    setHosting(next);
    setError(null);
    setLoading(true);
    try {
      await Promise.all([loadWidgets(next), loadSourcesForHosting(next)]);
    } catch (err) {
      setError(
        err instanceof KnowledgeIndexApiError
          ? err.message
          : "Failed to load sources",
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate() {
    if (createOrigins.length === 0) {
      setError("Add at least one website origin");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      syncApiBaseForHosting({
        scope: hosting === "cloud" ? "global" : "personal",
        hosting,
      });
      await createWidgetIntegration({
        name,
        sourceIds: [sourceId],
        allowedOrigins: createOrigins,
        brand: {
          projectName: name,
          projectColor: "#6b5a3e",
          projectLogo: null,
        },
      });
      await loadWidgets(hosting);
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
      syncApiBaseForHosting({
        scope: hosting === "cloud" ? "global" : "personal",
        hosting,
      });
      await updateWidgetIntegration(websiteId, { allowedOrigins: next });
      await loadWidgets(hosting);
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
      syncApiBaseForHosting({
        scope: hosting === "cloud" ? "global" : "personal",
        hosting,
      });
      await deleteWidgetIntegration(websiteId);
      await loadWidgets(hosting);
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

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div
        aria-hidden
        className="section-glow-cool pointer-events-none absolute inset-0"
      />

      <div className="relative mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 pb-16 sm:px-6 sm:py-8">
        <header>
          <p className="font-mono text-[0.625rem] font-semibold tracking-[0.14em] text-muted uppercase">
            Integrations
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
            Website chat widget
          </h1>
          <p className="mt-2 text-sm text-muted">
            Embed Ask AI on your site. Add each website origin you allow — no
            secret API keys in the browser.
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

            <div className="grid gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-muted">Bound source</span>
                <CloudLocalToggle
                  size="compact"
                  value={hosting}
                  onChange={(value) => void handleHostingChange(value)}
                  label="Source"
                  ariaLabel="Pick local or cloud sources"
                  localTitle="Sources indexed on your local API"
                  cloudTitle="Sources indexed in LedgeIndex cloud"
                />
              </div>
              <select
                className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
                value={sourceId}
                onChange={(e) => setSourceId(e.target.value)}
                disabled={loading || visibleSources.length === 0}
              >
                {visibleSources.length === 0 ? (
                  <option value="">
                    {loading
                      ? "Loading sources…"
                      : hosting === "local"
                        ? "No local sources — crawl one first, or switch to Cloud"
                        : "No cloud sources — need a personal cloud crawl or public catalog source"}
                  </option>
                ) : (
                  visibleSources.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.scope === "global"
                        ? `${s.name || s.id} (public)`
                        : s.name || s.id}
                    </option>
                  ))
                )}
              </select>
              <p className="text-[0.6875rem] leading-4 text-muted">
                {hosting === "local"
                  ? "Local is for testing against your machine. Production sites need Cloud."
                  : "Cloud source + your real HTTPS origins for production embeds."}
              </p>
            </div>

            <OriginsEditor
              draftId="create"
              origins={createOrigins}
              onChange={setCreateOrigins}
              disabled={creating}
            />

            <Button
              type="button"
              disabled={
                creating ||
                !sourceId ||
                !name.trim() ||
                createOrigins.length === 0
              }
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
            Local test page:{" "}
            <code className="rounded bg-surface-raised px-1">
              npm run test:serve -w @ledgeindex/widget
            </code>{" "}
            → allow{" "}
            <code className="rounded bg-surface-raised px-1">
              http://localhost:3456
            </code>{" "}
            then open{" "}
            <code className="rounded bg-surface-raised px-1">
              /test/?websiteId={widgets[0]?.websiteId ?? "wgt_…"}
            </code>
            .
          </span>
        </p>
      </div>
    </div>
  );
}
