"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LedgeIndexPageLoader } from "@/components/ledgeindex-page-loader";
import { SourceBannerCard } from "@/components/sources/source-banner-card";
import { SourceCategoryFilterBar } from "@/components/sources/source-category-filter";
import {
  SourceListRow,
  SourceListRowDragPreview,
  sourceListRowId,
} from "@/components/sources/source-list-row";
import { useDashboardToolbar } from "@/contexts/dashboard-toolbar-context";
import { useIndexedFlash } from "@/contexts/indexed-flash-context";
import { useAuth } from "@/lib/auth-context";
import { usePlanBilling } from "@/contexts/plan-billing-context";
import type { AccountSourceLimits } from "@/lib/billing-api";
import {
  deleteSource,
  listSources,
  reorderSources,
  type SourceCategoryOption,
  type SourceSummary,
} from "@/lib/ledgeindex-api";
import {
  SOURCE_KIND_PRESETS,
  normalizeSourceKindSlug,
  splitSourceCategories,
} from "@/lib/source-category-presets";
import { cn } from "@/lib/utils";

function sortSources(sources: SourceSummary[]) {
  return [...sources].sort((a, b) => {
    const aOrder = typeof a.displayOrder === "number" ? a.displayOrder : null;
    const bOrder = typeof b.displayOrder === "number" ? b.displayOrder : null;
    if (aOrder != null && bOrder != null && aOrder !== bOrder) {
      return aOrder - bOrder;
    }
    if ((aOrder != null) !== (bOrder != null)) {
      return aOrder != null ? -1 : 1;
    }
    if (a.chunkCount !== b.chunkCount) {
      return b.chunkCount - a.chunkCount;
    }
    return (b.indexedAt ?? "").localeCompare(a.indexedAt ?? "");
  });
}

function groupSourcesByFamily(sources: SourceSummary[]): SourceSummary[] {
  const byFamily = new Map<string, SourceSummary>();

  for (const source of sources) {
    const key = source.sourceFamilyId || source.id;
    const current = byFamily.get(key);
    if (!current || source.versionNumber > current.versionNumber) {
      byFamily.set(key, source);
    }
  }

  return sortSources([...byFamily.values()]);
}

function sourceShelfSlug(source: SourceSummary): string | null {
  return splitSourceCategories(source.categories ?? []).kind;
}

function buildShelfOptions(sources: SourceSummary[]): SourceCategoryOption[] {
  const counts = new Map<string, number>();
  for (const source of sources) {
    const kind = sourceShelfSlug(source);
    if (!kind) continue;
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }

  return SOURCE_KIND_PRESETS.map((preset) => ({
    slug: preset.slug,
    label: preset.label,
    count: counts.get(preset.slug) ?? 0,
  }));
}

function sourceMatchesQuery(source: SourceSummary, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    source.name,
    source.slug,
    source.startUrl,
    ...(source.categories ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

function DashboardContent() {
  const { user, loading: authLoading, isAdmin, planLimitsEnabled, profile } = useAuth();
  const { openUpgradeModal } = usePlanBilling();
  const searchParams = useSearchParams();
  const indexedParam = searchParams.get("indexed");
  const { flashId: indexedFlashId } = useIndexedFlash();
  const { scope, viewMode, ready: toolbarReady } = useDashboardToolbar();
  const [sources, setSources] = useState<SourceSummary[]>([]);
  const [sourceLimits, setSourceLimits] = useState<AccountSourceLimits | null>(
    null,
  );
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);
  const fetchSeqRef = useRef(0);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  useEffect(() => {
    if (authLoading || !user || !toolbarReady) return;

    const fetchSeq = ++fetchSeqRef.current;
    let cancelled = false;
    const loadScope = scope;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const { sources: next, meta } = await listSources(loadScope);
        if (cancelled || fetchSeq !== fetchSeqRef.current) return;
        setSources(groupSourcesByFamily(next));
        setSourceLimits(meta?.limits ?? null);
        setSelectedCategory((current) =>
          current &&
          (SOURCE_KIND_PRESETS.some((entry) => entry.slug === current) ||
            current === "uncategorized")
            ? current
            : null,
        );
      } catch (err) {
        if (cancelled || fetchSeq !== fetchSeqRef.current) return;
        setError(err instanceof Error ? err.message : "Failed to load sets");
      } finally {
        if (!cancelled && fetchSeq === fetchSeqRef.current) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [authLoading, user, toolbarReady, scope, indexedParam]);

  async function handleDeleteSource(sourceId: string) {
    setDeletingId(sourceId);
    setError(null);
    try {
      const summary = sources.find(
        (source) =>
          source.id === sourceId ||
          source.versions.some((version) => version.id === sourceId),
      );
      await deleteSource(
        sourceId,
        summary
          ? { scope: summary.scope, hosting: summary.hosting }
          : undefined,
      );
      setSources((current) =>
        current.filter(
          (source) =>
            source.id !== sourceId &&
            !source.versions.some((version) => version.id === sourceId),
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete set");
    } finally {
      setDeletingId(null);
    }
  }

  function handleSlugUpdated(sourceId: string, slug: string) {
    setSources((current) =>
      current.map((source) => {
        if (
          source.id === sourceId ||
          source.versions.some((version) => version.id === sourceId)
        ) {
          return { ...source, slug };
        }
        return source;
      }),
    );
  }

  function handleNameUpdated(sourceId: string, name: string) {
    setSources((current) =>
      current.map((source) => {
        if (
          source.id === sourceId ||
          source.versions.some((version) => version.id === sourceId)
        ) {
          return { ...source, name };
        }
        return source;
      }),
    );
  }

  function handleCategoriesUpdated(familyKey: string, categories: string[]) {
    setSources((current) =>
      current.map((source) =>
        (source.sourceFamilyId || source.id) === familyKey
          ? { ...source, categories }
          : source,
      ),
    );
  }

  function handleSiteProfileUpdated(
    sourceId: string,
    payload: { hasSiteProfile: boolean; siteProfileLensCount: number },
  ) {
    setSources((current) =>
      current.map((source) => {
        if (
          source.id === sourceId ||
          source.versions.some((version) => version.id === sourceId)
        ) {
          return {
            ...source,
            hasSiteProfile: payload.hasSiteProfile,
            siteProfileLensCount: payload.siteProfileLensCount,
          };
        }
        return source;
      }),
    );
  }

  function handleBrandingUpdated(
    sourceId: string,
    payload: { ogImageUrl: string | null; faviconUrl: string | null },
  ) {
    setSources((current) =>
      current.map((source) => {
        if (
          source.id === sourceId ||
          source.versions.some((version) => version.id === sourceId)
        ) {
          return {
            ...source,
            ogImageUrl: payload.ogImageUrl,
            faviconUrl: payload.faviconUrl,
          };
        }
        return source;
      }),
    );
  }

  function handleRefreshApplied() {
    void listSources(scope)
      .then(({ sources: next }) => setSources(groupSourcesByFamily(next)))
      .catch(() => {
        // keep existing list if refresh fails
      });
  }

  async function persistSourceOrder(ordered: SourceSummary[]) {
    const withOrder = ordered.map((source, index) => ({
      ...source,
      displayOrder: index,
    }));
    setSources(withOrder);
    setReordering(true);
    setError(null);
    try {
      await reorderSources(
        withOrder.map((source) => ({
          id: source.id,
          displayOrder: source.displayOrder ?? 0,
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save order");
      try {
        const { sources: next } = await listSources(scope);
        setSources(groupSourcesByFamily(next));
      } catch {
        // keep optimistic order if reload also fails
      }
    } finally {
      setReordering(false);
    }
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveDragId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveDragId(null);
    if (!over || active.id === over.id || reordering) return;

    const from = sources.findIndex(
      (source) => sourceListRowId(source) === String(active.id),
    );
    const to = sources.findIndex(
      (source) => sourceListRowId(source) === String(over.id),
    );
    if (from < 0 || to < 0 || from === to) return;
    void persistSourceOrder(arrayMove(sources, from, to));
  }

  function handleDragCancel() {
    setActiveDragId(null);
  }

  const canCreateInScope =
    (scope === "personal" || (scope === "global" && isAdmin)) &&
    (!sourceLimits?.apply || sourceLimits.canCreate);
  const showSourceLimitBanner =
    planLimitsEnabled &&
    !isAdmin &&
    profile?.plan !== "pro" &&
    sourceLimits?.apply &&
    sourceLimits.maxSources !== null;
  /** Dashboard management (shelves, catalog metadata) — admins on Public; actions on Just me for owners. */
  const canAdminManage = isAdmin;
  const canUseSourceActions = scope === "personal" || isAdmin;
  const canReorderList =
    canAdminManage &&
    viewMode === "list" &&
    !searchQuery.trim() &&
    selectedCategory === null &&
    !reordering;
  const newCrawlHref =
    scope === "global" && isAdmin
      ? "/sources/web-crawl?scope=global&fresh=1"
      : "/sources/web-crawl?fresh=1";
  const showLoading = authLoading || !user || !toolbarReady || loading;

  const filteredSources = useMemo(
    () => sources.filter((source) => sourceMatchesQuery(source, searchQuery)),
    [sources, searchQuery],
  );

  const shelfOptions = useMemo(
    () => buildShelfOptions(filteredSources),
    [filteredSources],
  );
  const uncategorizedCount = useMemo(
    () => filteredSources.filter((source) => !sourceShelfSlug(source)).length,
    [filteredSources],
  );
  const filterOptions = useMemo(() => {
    const options = [...shelfOptions];
    if (uncategorizedCount > 0) {
      options.push({
        slug: "uncategorized",
        label: "Uncategorized",
        count: uncategorizedCount,
      });
    }
    return options;
  }, [shelfOptions, uncategorizedCount]);

  const shelves = useMemo(() => {
    const byShelf = new Map<string, SourceSummary[]>();
    const uncategorized: SourceSummary[] = [];

    for (const source of filteredSources) {
      const kind = sourceShelfSlug(source);
      if (!kind) {
        uncategorized.push(source);
        continue;
      }
      const list = byShelf.get(kind) ?? [];
      list.push(source);
      byShelf.set(kind, list);
    }

    const ordered = SOURCE_KIND_PRESETS.map((preset) => ({
      slug: preset.slug,
      label: preset.label,
      sources: byShelf.get(preset.slug) ?? [],
    })).filter((shelf) => {
      if (selectedCategory === null) return shelf.sources.length > 0;
      return selectedCategory === shelf.slug;
    });

    const showUncategorized =
      uncategorized.length > 0 &&
      (selectedCategory === null || selectedCategory === "uncategorized");

    return {
      shelves: ordered,
      uncategorized: showUncategorized ? uncategorized : [],
    };
  }, [filteredSources, selectedCategory]);

  const listSourcesVisible = useMemo(() => {
    if (selectedCategory === null) return filteredSources;
    if (selectedCategory === "uncategorized") {
      return filteredSources.filter((source) => !sourceShelfSlug(source));
    }
    const normalized = normalizeSourceKindSlug(selectedCategory);
    return filteredSources.filter(
      (source) => sourceShelfSlug(source) === normalized,
    );
  }, [filteredSources, selectedCategory]);

  const catalogRankById = useMemo(() => {
    const ranks = new Map<string, number>();
    sources.forEach((source, index) => {
      ranks.set(sourceListRowId(source), index + 1);
    });
    return ranks;
  }, [sources]);

  const sortableIds = useMemo(
    () => listSourcesVisible.map((source) => sourceListRowId(source)),
    [listSourcesVisible],
  );

  const activeDragSource = useMemo(() => {
    if (!activeDragId) return null;
    return (
      sources.find((source) => sourceListRowId(source) === activeDragId) ?? null
    );
  }, [activeDragId, sources]);

  const emptyAfterFilter =
    listSourcesVisible.length === 0 &&
    (Boolean(searchQuery.trim()) || selectedCategory !== null);

  if (showLoading) {
    return (
      <LedgeIndexPageLoader className="min-h-[calc(100dvh-5.5rem)] w-full" />
    );
  }

  return (
    <div
      className={cn(
        "mx-auto w-full flex-1 px-4 py-6 sm:px-6 sm:py-8",
        viewMode === "list" ? "max-w-3xl" : "max-w-6xl",
      )}
    >
      {sources.length === 0 ? (
        error ? (
          <p className="text-sm text-red-600 dark:text-red-300">{error}</p>
        ) : (
        <div className="rounded-xl border border-dashed border-border bg-card-solid/60 px-6 py-12 text-center">
          <p className="text-sm text-muted">
            {scope === "global"
              ? "No public sets yet."
              : "No personal sets yet."}
          </p>
          {canCreateInScope ? (
            <Link
              href={newCrawlHref}
              className="mt-4 inline-flex text-sm font-medium text-accent hover:underline"
            >
              {scope === "global"
                ? "Create the first global set →"
                : "Run your first crawl →"}
            </Link>
          ) : null}
        </div>
        )
      ) : (
        <div className="space-y-5">
          {showSourceLimitBanner ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              <p>
                Free plan: {sourceLimits.currentSourceCount}/
                {sourceLimits.maxSources}{" "}
                {scope === "global" ? "public" : "personal"} source
                {sourceLimits.maxSources === 1 ? "" : "s"}.
              </p>
              {!sourceLimits.canCreate ? (
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
            <p className="text-sm text-red-600 dark:text-red-300">{error}</p>
          ) : null}
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="font-mono text-[0.5625rem] font-semibold tracking-[0.12em] text-muted uppercase">
                  {viewMode === "list" ? "Catalog" : "Bookshelf"}
                </p>
                <p className="mt-1 text-sm text-muted">
                  Click a set to chat
                  {canUseSourceActions ? " · right-click for actions" : ""}
                  {canReorderList ? " · drag to reorder" : ""}
                  {canAdminManage &&
                  viewMode === "list" &&
                  !canReorderList &&
                  (Boolean(searchQuery.trim()) || selectedCategory !== null)
                    ? " · clear search/filter to reorder"
                    : ""}
                  .
                </p>
              </div>
              <SourceCategoryFilterBar
                categories={filterOptions}
                selected={selectedCategory}
                onChange={setSelectedCategory}
                className="sm:justify-end"
              />
            </div>

            <label className="relative block w-full max-w-md">
              <span className="sr-only">Search sets</span>
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted"
                aria-hidden
              />
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search sets…"
                className="field-input w-full py-2 pr-3 pl-9 text-sm"
                autoComplete="off"
              />
            </label>
          </div>

          {emptyAfterFilter ? (
            <div className="rounded-xl border border-dashed border-border bg-card-solid/60 px-6 py-12 text-center">
              <p className="text-sm text-muted">
                {searchQuery.trim()
                  ? `No sets match “${searchQuery.trim()}”.`
                  : "No sets on this shelf."}
              </p>
            </div>
          ) : (
            <>
              <div
                className={cn(
                  "flex flex-col gap-1",
                  viewMode !== "list" && "hidden",
                )}
                aria-hidden={viewMode !== "list"}
              >
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                  onDragCancel={handleDragCancel}
                >
                  <SortableContext
                    items={sortableIds}
                    strategy={verticalListSortingStrategy}
                  >
                    {listSourcesVisible.map((source) => {
                      const rowId = sourceListRowId(source);
                      return (
                        <SourceListRow
                          key={rowId}
                          source={source}
                          rank={catalogRankById.get(rowId)}
                          highlighted={source.id === indexedFlashId}
                          onDelete={
                            canUseSourceActions ? handleDeleteSource : undefined
                          }
                          deleting={deletingId === source.id}
                          canEditSlug={canAdminManage}
                          canEditName={canAdminManage}
                          canEditCategories={canAdminManage}
                          canReorder={canReorderList}
                          showActionsMenu={canUseSourceActions}
                          onSlugUpdated={handleSlugUpdated}
                          onNameUpdated={handleNameUpdated}
                          onCategoriesUpdated={handleCategoriesUpdated}
                          onRefreshApplied={handleRefreshApplied}
                          onSiteProfileUpdated={handleSiteProfileUpdated}
                          onBrandingUpdated={handleBrandingUpdated}
                        />
                      );
                    })}
                  </SortableContext>
                  <DragOverlay dropAnimation={{ duration: 180, easing: "ease-out" }}>
                    {activeDragSource ? (
                      <SourceListRowDragPreview
                        source={activeDragSource}
                        rank={catalogRankById.get(
                          sourceListRowId(activeDragSource),
                        )}
                      />
                    ) : null}
                  </DragOverlay>
                </DndContext>
              </div>

              <div
                className={cn(
                  "space-y-8",
                  viewMode !== "grid" && "hidden",
                )}
                aria-hidden={viewMode !== "grid"}
              >
                {shelves.shelves.map((shelf) => (
                  <section key={shelf.slug} className="space-y-3">
                    <div className="flex items-baseline justify-between gap-3 border-b border-border/70 pb-2">
                      <h2 className="text-sm font-semibold text-foreground">
                        {shelf.label}
                      </h2>
                      <span className="font-mono text-[0.5625rem] tracking-[0.08em] text-muted uppercase">
                        {shelf.sources.length}{" "}
                        {shelf.sources.length === 1 ? "set" : "sets"}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {shelf.sources.map((source) => (
                        <SourceBannerCard
                          key={source.sourceFamilyId || source.id}
                          source={source}
                          highlighted={source.id === indexedFlashId}
                          onDelete={
                            canUseSourceActions ? handleDeleteSource : undefined
                          }
                          deleting={deletingId === source.id}
                          canEditCategories={canAdminManage}
                          showContextMenu={canUseSourceActions}
                          onCategoriesUpdated={handleCategoriesUpdated}
                          onNameUpdated={handleNameUpdated}
                          onSlugUpdated={handleSlugUpdated}
                          onRefreshApplied={handleRefreshApplied}
                          onSiteProfileUpdated={handleSiteProfileUpdated}
                          onBrandingUpdated={handleBrandingUpdated}
                        />
                      ))}
                    </div>
                  </section>
                ))}

                {shelves.uncategorized.length > 0 ? (
                  <section className="space-y-3">
                    <div className="flex items-baseline justify-between gap-3 border-b border-border/70 pb-2">
                      <h2 className="text-sm font-semibold text-foreground">
                        Uncategorized
                      </h2>
                      <span className="font-mono text-[0.5625rem] tracking-[0.08em] text-muted uppercase">
                        {shelves.uncategorized.length}{" "}
                        {shelves.uncategorized.length === 1 ? "set" : "sets"}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {shelves.uncategorized.map((source) => (
                        <SourceBannerCard
                          key={source.sourceFamilyId || source.id}
                          source={source}
                          highlighted={source.id === indexedFlashId}
                          onDelete={
                            canUseSourceActions ? handleDeleteSource : undefined
                          }
                          deleting={deletingId === source.id}
                          canEditCategories={canAdminManage}
                          showContextMenu={canUseSourceActions}
                          onCategoriesUpdated={handleCategoriesUpdated}
                          onNameUpdated={handleNameUpdated}
                          onSlugUpdated={handleSlugUpdated}
                          onRefreshApplied={handleRefreshApplied}
                          onSiteProfileUpdated={handleSiteProfileUpdated}
                          onBrandingUpdated={handleBrandingUpdated}
                        />
                      ))}
                    </div>
                  </section>
                ) : null}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <LedgeIndexPageLoader className="min-h-[calc(100dvh-5.5rem)] w-full" />
      }
    >
      <DashboardContent />
    </Suspense>
  );
}
