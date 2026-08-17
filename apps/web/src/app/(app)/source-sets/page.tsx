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
  resolveRemoteApiBaseUrl,
  type SourceSetLimits,
  type SourceSetSummary,
  type SourceSummary,
  updateSourceSet,
} from "@/lib/ledgeindex-api";
import { useAuth } from "@/lib/auth-context";
import { usePlanBilling } from "@/contexts/plan-billing-context";
import {
  KnowledgeSetScopeToggle,
  type KnowledgeSetScope,
} from "@/components/sources/knowledge-set-scope-toggle";
import { formatSourceListMeta } from "@/components/sources/source-display";
import { FilterBadge } from "@/components/sources/source-category-filter";
import { resolveSourceStorage } from "@/components/sources/source-cloud-badge";
import { syncDesktopApiBaseForScope } from "@/lib/desktop-api-routing";
import { cn } from "@/lib/utils";

const UNLIMITED: SourceSetLimits = {
  apply: false,
  maxSourceSets: null,
  maxSourcesPerSet: null,
  currentSourceSetCount: 0,
  canCreate: true,
};

type PersonalStorageFilter = "all" | "local" | "cloud";

export default function SourceSetsPage() {
  const { profile, isAdmin } = useAuth();
  const { planLimitsEnabled, openUpgradeModal, showPlanLimit } = usePlanBilling();
  const [sourceSets, setSourceSets] = useState<SourceSetSummary[]>([]);
  const [limits, setLimits] = useState<SourceSetLimits>(UNLIMITED);
  const [sources, setSources] = useState<SourceSummary[]>([]);
  const [sourceScopeTab, setSourceScopeTab] =
    useState<KnowledgeSetScope>("personal");
  const [personalStorageFilter, setPersonalStorageFilter] =
    useState<PersonalStorageFilter>("all");
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

  const personalSources = useMemo(
    () =>
      sources.filter((source) => (source.scope ?? "personal") !== "global"),
    [sources],
  );
  const publicSources = useMemo(
    () => sources.filter((source) => source.scope === "global"),
    [sources],
  );

  const personalStorageCounts = useMemo(() => {
    let local = 0;
    let cloud = 0;
    for (const source of personalSources) {
      if (resolveSourceStorage(source) === "cloud") cloud += 1;
      else local += 1;
    }
    return { all: personalSources.length, local, cloud };
  }, [personalSources]);

  const visibleSources = useMemo(() => {
    if (sourceScopeTab === "global") return publicSources;
    if (personalStorageFilter === "all") return personalSources;
    return personalSources.filter((source) => {
      const storage = resolveSourceStorage(source);
      return personalStorageFilter === "cloud"
        ? storage === "cloud"
        : storage === "local";
    });
  }, [
    sourceScopeTab,
    publicSources,
    personalSources,
    personalStorageFilter,
  ]);

  const hiddenSelectedCount = useMemo(() => {
    const visibleIds = new Set(visibleSources.map((source) => source.id));
    return selectedSourceIds.filter((id) => !visibleIds.has(id)).length;
  }, [selectedSourceIds, visibleSources]);

  function handleSourceScopeTabChange(next: KnowledgeSetScope) {
    setSourceScopeTab(next);
    syncDesktopApiBaseForScope(next);
  }

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [setsResult, sourcesResult] = await Promise.all([
        listSourceSets(),
        listSources("all"),
      ]);
      setSourceSets(setsResult.sourceSets);
      setLimits(setsResult.meta?.limits ?? UNLIMITED);
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

  const maxSourcesPerSet = limits.maxSourcesPerSet;
  const atSourceLimit =
    maxSourcesPerSet !== null &&
    selectedSourceIds.length >= maxSourcesPerSet;
  const showFreeLimits =
    limits.apply &&
    !isAdmin &&
    profile?.plan !== "pro" &&
    (limits.maxSourceSets !== null || limits.maxSourcesPerSet !== null);

  function toggleSource(sourceId: string) {
    setSelectedSourceIds((current) => {
      if (current.includes(sourceId)) {
        return current.filter((id) => id !== sourceId);
      }
      if (
        maxSourcesPerSet !== null &&
        current.length >= maxSourcesPerSet
      ) {
        const message = `Free plan allows up to ${maxSourcesPerSet} sources per set.`;
        if (planLimitsEnabled) {
          showPlanLimit(message);
        } else {
          setError(message);
        }
        return current;
      }
      setError(null);
      return [...current, sourceId];
    });
  }

  async function handleSave() {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }

    if (
      maxSourcesPerSet !== null &&
      selectedSourceIds.length > maxSourcesPerSet
    ) {
      const message = `Free plan allows up to ${maxSourcesPerSet} sources per set.`;
      if (planLimitsEnabled) showPlanLimit(message);
      else setError(message);
      return;
    }

    if (!selectedId && !limits.canCreate) {
      const message = "Free plan allows one source set. Upgrade to add more.";
      if (planLimitsEnabled) showPlanLimit(message);
      else setError(message);
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
      const message =
        err instanceof KnowledgeIndexApiError
          ? err.message
          : "Failed to save source set";
      if (
        planLimitsEnabled &&
        err instanceof KnowledgeIndexApiError &&
        err.status === 403
      ) {
        showPlanLimit(message);
      } else {
        setError(message);
      }
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
        <Button
          onClick={() => resetForm()}
          variant="secondary"
          disabled={!limits.canCreate && !selectedId}
          title={
            !limits.canCreate
              ? "Free plan allows one source set"
              : undefined
          }
        >
          <Plus className="mr-2 h-4 w-4" />
          New set
        </Button>
      </div>

      {showFreeLimits ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          <p>
            Free plan:{" "}
            {limits.maxSourceSets !== null
              ? `${limits.currentSourceSetCount}/${limits.maxSourceSets} source set`
              : null}
            {limits.maxSourceSets !== null && limits.maxSourcesPerSet !== null
              ? " · "
              : null}
            {limits.maxSourcesPerSet !== null
              ? `up to ${limits.maxSourcesPerSet} sources per set`
              : null}
            .
          </p>
          {planLimitsEnabled ? (
            <Button
              variant="secondary"
              className="h-8 px-3 text-xs"
              onClick={() => openUpgradeModal()}
            >
              Upgrade to Pro
            </Button>
          ) : null}
        </div>
      ) : null}

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
                        {set.slug ? (
                          <span className="rounded-md border border-border bg-card-solid px-2 py-0.5 font-mono text-[0.6875rem] text-foreground/80">
                            {set.slug}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {set.sourceCount} source
                        {set.sourceCount === 1 ? "" : "s"}
                      </p>
                      {set.sources.length > 0 ? (
                        <p className="mt-0.5 line-clamp-2 text-xs text-foreground/70">
                          {set.sources.map((source) => source.name).join(" · ")}
                        </p>
                      ) : null}
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
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="text-sm font-medium">Sources</label>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>
                      {selectedSourceIds.length} selected
                      {hiddenSelectedCount > 0
                        ? ` (${hiddenSelectedCount} on another tab)`
                        : null}
                      {maxSourcesPerSet !== null
                        ? ` · max ${maxSourcesPerSet}`
                        : null}
                    </span>
                    {selectedSourceIds.length > 0 ? (
                      <button
                        type="button"
                        className="font-medium text-foreground/80 underline-offset-2 hover:underline"
                        onClick={() => setSelectedSourceIds([])}
                      >
                        Clear all
                      </button>
                    ) : null}
                  </div>
                </div>
                <KnowledgeSetScopeToggle
                  value={sourceScopeTab}
                  onChange={handleSourceScopeTabChange}
                  size="compact"
                  publicLocked={!isAdmin}
                />
                {sourceScopeTab === "personal" ? (
                  <div className="flex flex-wrap items-center gap-1">
                    <FilterBadge
                      active={personalStorageFilter === "local"}
                      onClick={() =>
                        setPersonalStorageFilter(
                          personalStorageFilter === "local" ? "all" : "local",
                        )
                      }
                    >
                      Local
                      <span className="opacity-60">
                        ({personalStorageCounts.local})
                      </span>
                    </FilterBadge>
                    <FilterBadge
                      active={personalStorageFilter === "cloud"}
                      onClick={() =>
                        setPersonalStorageFilter(
                          personalStorageFilter === "cloud" ? "all" : "cloud",
                        )
                      }
                    >
                      Cloud
                      <span className="opacity-60">
                        ({personalStorageCounts.cloud})
                      </span>
                    </FilterBadge>
                  </div>
                ) : null}
                {hiddenSelectedCount > 0 ? (
                  <p className="rounded-md border border-border/80 bg-muted/30 px-2.5 py-2 text-xs text-muted-foreground">
                    Selection applies across Just me and Public tabs. Switch
                    tabs to uncheck sources you do not want, or use Clear all.
                  </p>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  {sourceScopeTab === "personal"
                    ? "Just me — private sources on this device (Local) or your LedgeIndex cloud account (Cloud)."
                    : `${publicSources.length} public catalog source${
                        publicSources.length === 1 ? "" : "s"
                      }`}
                </p>
                <div className="max-h-64 space-y-2 overflow-y-auto rounded-lg border border-border p-3">
                  {visibleSources.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {sourceScopeTab === "personal"
                        ? "No private sources yet. Index one from the dashboard or web crawl."
                        : isAdmin
                          ? resolveRemoteApiBaseUrl()
                            ? "No public catalog sources returned. Check sign-in and that api.ledgeindex.com is reachable."
                            : "Set NEXT_PUBLIC_LEDGEINDEX_REMOTE_API_URL=https://api.ledgeindex.com in apps/web/.env.local and restart the web dev server to list the hosted public catalog locally."
                          : "Public catalog sources are admin-only."}
                    </p>
                  ) : (
                    visibleSources.map((source) => {
                      const checked = selectedSourceIds.includes(source.id);
                      const disabled =
                        !checked &&
                        atSourceLimit &&
                        showFreeLimits;
                      return (
                      <label
                        key={source.id}
                        className={cn(
                          "flex items-start gap-3 rounded-md px-2 py-2",
                          disabled
                            ? "cursor-not-allowed opacity-50"
                            : "cursor-pointer hover:bg-muted/40",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disabled}
                          onChange={() => toggleSource(source.id)}
                          className="mt-1 size-4"
                        />
                        <span>
                          <span className="font-medium">{source.name}</span>
                          <span className="ml-2 font-mono text-xs text-muted-foreground">
                            {source.slug}
                          </span>
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            {formatSourceListMeta(source)}
                          </span>
                        </span>
                      </label>
                      );
                    })
                  )}
                </div>
              </div>
              <Button
                disabled={
                  saving ||
                  (!selectedId && !limits.canCreate) ||
                  !name.trim()
                }
                onClick={() => void handleSave()}
              >
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
