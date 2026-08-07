"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Layers, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  createSourceSet,
  deleteSourceSet,
  KnowledgeIndexApiError,
  listSourceSets,
  listSources,
  type SourceSetSummary,
  type SourceSummary,
  updateSourceSet,
} from "@/lib/ledgeindex-api";
import { cn } from "@/lib/utils";

export default function SourceSetsPage() {
  const [sourceSets, setSourceSets] = useState<SourceSetSummary[]>([]);
  const [sources, setSources] = useState<SourceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const loadedRef = useRef(false);

  const selectedSet = useMemo(
    () => sourceSets.find((set) => set.id === selectedId) ?? null,
    [sourceSets, selectedId],
  );

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [setsResult, sourcesResult] = await Promise.all([
        listSourceSets(),
        listSources("all"),
      ]);
      setSourceSets(setsResult.sourceSets);
      setSources(sourcesResult.sources);
    } catch (err) {
      setError(
        err instanceof KnowledgeIndexApiError
          ? err.message
          : "Failed to load source sets",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    void loadData();
  }, []);

  function resetForm(set?: SourceSetSummary | null) {
    setName(set?.name ?? "");
    setSelectedSourceIds(set?.sources.map((source) => source.id) ?? []);
    setSelectedId(set?.id ?? null);
  }

  function toggleSource(sourceId: string) {
    setSelectedSourceIds((current) =>
      current.includes(sourceId)
        ? current.filter((id) => id !== sourceId)
        : [...current, sourceId],
    );
  }

  async function handleSave() {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (selectedId) {
        await updateSourceSet(selectedId, {
          name: name.trim(),
          sourceIds: selectedSourceIds,
        });
      } else {
        // Slug is auto-generated server-side from the name.
        await createSourceSet({
          name: name.trim(),
          sourceIds: selectedSourceIds,
        });
      }

      await loadData();
      resetForm();
    } catch (err) {
      setError(
        err instanceof KnowledgeIndexApiError
          ? err.message
          : "Failed to save source set",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    setError(null);
    try {
      await deleteSourceSet(id);
      if (selectedId === id) resetForm();
      await loadData();
    } catch (err) {
      setError(
        err instanceof KnowledgeIndexApiError
          ? err.message
          : "Failed to delete source set",
      );
    } finally {
      setDeletingId(null);
    }
  }

  async function handleCopyId(id: string) {
    try {
      await navigator.clipboard.writeText(id);
      setCopiedId(id);
      window.setTimeout(() => {
        setCopiedId((current) => (current === id ? null : current));
      }, 1600);
    } catch {
      setError("Failed to copy id");
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Source sets</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Group knowledge sources for MCP clients. Reference a set by its
            auto-generated slug (or id).
          </p>
        </div>
        <Button onClick={() => resetForm()} variant="secondary">
          <Plus className="mr-2 h-4 w-4" />
          New set
        </Button>
      </div>

      {error ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading source sets…
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className="space-y-3">
            {sourceSets.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
                No source sets yet. Create one to expose grouped sources over MCP.
              </div>
            ) : (
              sourceSets.map((set) => (
                <div
                  key={set.id}
                  className={cn(
                    "flex w-full flex-col gap-2 rounded-xl border p-4 text-left transition-colors",
                    selectedId === set.id
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-muted/40",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => resetForm(set)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Layers className="h-4 w-4 shrink-0 text-primary" />
                        <span className="font-medium">{set.name}</span>
                        <span className="rounded bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
                          {set.slug}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {set.sourceCount} source
                        {set.sourceCount === 1 ? "" : "s"}
                      </p>
                    </button>
                    <Button
                      type="button"
                      variant="secondary"
                      className="h-9 w-9 shrink-0 rounded-full p-0"
                      disabled={deletingId === set.id}
                      onClick={() => void handleDelete(set.id)}
                    >
                      {deletingId === set.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  <div className="flex min-w-0 items-center gap-1.5">
                    <p className="min-w-0 flex-1 truncate font-mono text-[0.625rem] text-muted-foreground">
                      id · {set.id}
                    </p>
                    <button
                      type="button"
                      onClick={() => void handleCopyId(set.id)}
                      className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-border bg-card-solid px-1.5 font-mono text-[0.5625rem] text-muted-foreground transition-colors hover:text-foreground"
                      title="Copy id"
                    >
                      {copiedId === set.id ? (
                        <Check className="h-3 w-3" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                      {copiedId === set.id ? "Copied" : "Copy"}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="rounded-xl border border-border p-5">
            <h2 className="text-lg font-medium">
              {selectedSet ? "Edit source set" : "Create source set"}
            </h2>
            <div className="mt-4 space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Name</label>
                <input
                  className="flex h-10 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Dev Stack"
                />
              </div>
              {selectedSet ? (
                <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground">
                  <p>
                    Slug{" "}
                    <span className="font-mono text-foreground">
                      {selectedSet.slug}
                    </span>
                  </p>
                  <p className="mt-1 truncate">
                    Id{" "}
                    <span className="font-mono text-foreground">
                      {selectedSet.id}
                    </span>
                  </p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Slug is generated from the name when you create the set. You
                  can also reference the set id.
                </p>
              )}
              <div className="space-y-2">
                <label className="text-sm font-medium">Sources</label>
                <div className="max-h-64 space-y-2 overflow-y-auto rounded-lg border border-border p-3">
                  {sources.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No sources available yet.
                    </p>
                  ) : (
                    sources.map((source) => (
                      <label
                        key={source.id}
                        className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 hover:bg-muted/40"
                      >
                        <input
                          type="checkbox"
                          checked={selectedSourceIds.includes(source.id)}
                          onChange={() => toggleSource(source.id)}
                          className="mt-1"
                        />
                        <span>
                          <span className="font-medium">{source.name}</span>
                          <span className="ml-2 font-mono text-xs text-muted-foreground">
                            {source.slug}
                          </span>
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            {source.scope} · {source.pageCount} pages
                          </span>
                        </span>
                      </label>
                    ))
                  )}
                </div>
              </div>
              <Button disabled={saving} onClick={() => void handleSave()}>
                {saving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                {selectedSet ? "Save changes" : "Create source set"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
