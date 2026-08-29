"use client";

import { useState } from "react";
import {
  Database,
  FolderKanban,
  Globe2,
  HardDrive,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  KnowledgeIndexApiError,
  listSources,
  listSourceSets,
  type SourceSetSummary,
  type SourceSummary,
} from "@/lib/ledgeindex-api";
import { cn } from "@/lib/utils";

export type PlaygroundTarget =
  | {
      kind: "sources";
      ids: [string, ...string[]];
      name: string;
      sourceSlugs: [string, ...string[]];
      scope: "personal" | "global";
      hosting: "local" | "cloud";
    }
  | {
      kind: "source-set";
      id: string;
      name: string;
      sourceSlugs: [string, ...string[]];
      scope: "personal";
      hosting: "local" | "cloud";
    };

function sourceHosting(source: SourceSummary): "local" | "cloud" {
  return source.scope === "global" || source.hosting === "cloud"
    ? "cloud"
    : "local";
}

function targetForSources(
  selectedSources: SourceSummary[]
): PlaygroundTarget | null {
  if (selectedSources.length === 0) return null;
  const names = selectedSources.map((source) => source.name || source.slug);
  const sourceSlugs = selectedSources.map((source) => source.slug);
  const ids = selectedSources.map((source) => source.id);
  const includesLocal = selectedSources.some(
    (source) => sourceHosting(source) === "local"
  );
  const allGlobal = selectedSources.every(
    (source) => source.scope === "global"
  );
  return {
    kind: "sources",
    ids: [ids[0]!, ...ids.slice(1)],
    name:
      names.length === 1
        ? names[0]!
        : `${names[0]} + ${names.length - 1} more`,
    sourceSlugs: [sourceSlugs[0]!, ...sourceSlugs.slice(1)],
    scope: allGlobal ? "global" : "personal",
    // Mixed selections enter through the local sidecar. The Explore processor
    // still chooses local or cloud retrieval independently for each source.
    hosting: includesLocal ? "local" : "cloud",
  };
}

function targetForSet(
  sourceSet: SourceSetSummary,
  sources: SourceSummary[]
): PlaygroundTarget | null {
  const slugs = sourceSet.sources
    .map((source) => source.slug.trim())
    .filter(Boolean);
  if (slugs.length === 0) return null;
  const localIds = new Set(
    sources
      .filter((source) => sourceHosting(source) === "local")
      .map((source) => source.id)
  );
  const includesLocal = sourceSet.sources.some((source) =>
    localIds.has(source.id)
  );
  return {
    kind: "source-set",
    id: sourceSet.id,
    name: sourceSet.name,
    sourceSlugs: [slugs[0]!, ...slugs.slice(1)],
    scope: "personal",
    hosting: includesLocal ? "local" : "cloud",
  };
}

function PickerRow({
  icon: Icon,
  name,
  detail,
  selected,
  disabled,
  onClick,
}: {
  icon: typeof Database;
  name: string;
  detail: string;
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
        selected
          ? "border-accent/50 bg-accent/10"
          : "border-border bg-background hover:bg-surface-raised",
        disabled && "cursor-not-allowed opacity-50"
      )}
    >
      <Icon className="size-4 shrink-0 text-muted" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">
          {name}
        </span>
        <span className="block truncate text-xs text-muted">{detail}</span>
      </span>
    </button>
  );
}

export function PlaygroundSourcePicker({
  value,
  onChange,
  disabled,
}: {
  value: PlaygroundTarget | null;
  onChange: (target: PlaygroundTarget | null) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [draftSourceIds, setDraftSourceIds] = useState<string[]>([]);
  const [sources, setSources] = useState<SourceSummary[]>([]);
  const [sourceSets, setSourceSets] = useState<SourceSetSummary[]>([]);

  async function loadOptions() {
    if (loaded || loading) return;
    setLoading(true);
    setError(null);
    try {
      const [sourceResult, sourceSetResult] = await Promise.all([
        listSources("all"),
        listSourceSets(),
      ]);
      setSources(sourceResult.sources);
      setSourceSets(sourceSetResult.sourceSets);
      setLoaded(true);
    } catch (loadError) {
      setError(
        loadError instanceof KnowledgeIndexApiError
          ? loadError.message
          : "Failed to load sources"
      );
    } finally {
      setLoading(false);
    }
  }

  function changeOpen(next: boolean) {
    setOpen(next);
    if (next) {
      setDraftSourceIds(value?.kind === "sources" ? value.ids : []);
      void loadOptions();
    }
  }

  const normalizedQuery = query.trim().toLowerCase();
  const matches = (valueToMatch: string) =>
    !normalizedQuery || valueToMatch.toLowerCase().includes(normalizedQuery);
  const visibleSets = sourceSets.filter((sourceSet) => matches(sourceSet.name));
  const visibleSources = sources.filter((source) =>
    matches(`${source.name} ${source.slug} ${source.startUrl}`)
  );
  const ownLocal = visibleSources.filter(
    (source) => source.scope !== "global" && sourceHosting(source) === "local"
  );
  const ownCloud = visibleSources.filter(
    (source) => source.scope !== "global" && sourceHosting(source) === "cloud"
  );
  const publicSources = visibleSources.filter(
    (source) => source.scope === "global"
  );

  function selectSourceSet(target: PlaygroundTarget) {
    onChange(target);
    setOpen(false);
  }

  function toggleSource(sourceId: string) {
    setDraftSourceIds((current) => {
      if (current.includes(sourceId)) {
        return current.filter((id) => id !== sourceId);
      }
      if (current.length >= 3) return current;
      return [...current, sourceId];
    });
  }

  const selectedSources = draftSourceIds
    .map((id) => sources.find((source) => source.id === id))
    .filter((source): source is SourceSummary => Boolean(source));
  const sourceTarget = targetForSources(selectedSources);

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        className="h-8 gap-1.5 rounded-lg px-2.5 text-xs"
        disabled={disabled}
        onClick={() => changeOpen(true)}
      >
        <Database className="size-3.5" aria-hidden />
        {value ? value.name : "Select source or source set"}
      </Button>

      <Dialog
        open={open}
        onOpenChange={changeOpen}
        className="w-[calc(100%_-_2rem)] max-w-xl"
      >
        <DialogHeader>
          <DialogTitle>Select knowledge</DialogTitle>
          <p className="text-sm text-muted">
            Choose up to three sources, or use one source set.
          </p>
        </DialogHeader>
        <DialogContent className="mt-4 grid gap-4">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search sources and sets"
            className="h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground"
          />

          {loading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Loading sources…
            </div>
          ) : error ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : (
            <div className="grid max-h-[24rem] gap-5 overflow-y-auto pr-1">
              {visibleSets.length === 0 && visibleSources.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted">
                  {normalizedQuery
                    ? "No sources or source sets match your search."
                    : "No indexed sources or source sets are available yet."}
                </p>
              ) : null}
              {visibleSets.length > 0 ? (
                <section className="grid gap-2">
                  <h3 className="font-mono text-[0.625rem] font-semibold tracking-[0.12em] text-muted uppercase">
                    Source sets
                  </h3>
                  {visibleSets.map((sourceSet) => {
                    const target = targetForSet(sourceSet, sources);
                    return (
                      <PickerRow
                        key={sourceSet.id}
                        icon={FolderKanban}
                        name={sourceSet.name}
                        detail={`${sourceSet.sourceCount} source${sourceSet.sourceCount === 1 ? "" : "s"}`}
                        selected={
                          value?.kind === "source-set" &&
                          value.id === sourceSet.id
                        }
                        disabled={!target}
                        onClick={() => {
                          if (target) selectSourceSet(target);
                        }}
                      />
                    );
                  })}
                </section>
              ) : null}

              {ownLocal.length > 0 ? (
                <section className="grid gap-2">
                  <h3 className="font-mono text-[0.625rem] font-semibold tracking-[0.12em] text-muted uppercase">
                    Your local sources
                  </h3>
                  {ownLocal.map((source) => (
                    <PickerRow
                      key={source.id}
                      icon={HardDrive}
                      name={source.name || source.slug}
                      detail={source.startUrl || "Local source"}
                      selected={
                        draftSourceIds.includes(source.id)
                      }
                      disabled={
                        draftSourceIds.length >= 3 &&
                        !draftSourceIds.includes(source.id)
                      }
                      onClick={() => toggleSource(source.id)}
                    />
                  ))}
                </section>
              ) : null}

              {ownCloud.length > 0 ? (
                <section className="grid gap-2">
                  <h3 className="font-mono text-[0.625rem] font-semibold tracking-[0.12em] text-muted uppercase">
                    Your cloud sources
                  </h3>
                  {ownCloud.map((source) => (
                    <PickerRow
                      key={source.id}
                      icon={Database}
                      name={source.name || source.slug}
                      detail={source.startUrl || "Cloud source"}
                      selected={
                        draftSourceIds.includes(source.id)
                      }
                      disabled={
                        draftSourceIds.length >= 3 &&
                        !draftSourceIds.includes(source.id)
                      }
                      onClick={() => toggleSource(source.id)}
                    />
                  ))}
                </section>
              ) : null}

              {publicSources.length > 0 ? (
                <section className="grid gap-2">
                  <h3 className="font-mono text-[0.625rem] font-semibold tracking-[0.12em] text-muted uppercase">
                    Public sources
                  </h3>
                  {publicSources.map((source) => (
                    <PickerRow
                      key={source.id}
                      icon={Globe2}
                      name={source.name || source.slug}
                      detail={source.startUrl || "Public catalog"}
                      selected={
                        draftSourceIds.includes(source.id)
                      }
                      disabled={
                        draftSourceIds.length >= 3 &&
                        !draftSourceIds.includes(source.id)
                      }
                      onClick={() => toggleSource(source.id)}
                    />
                  ))}
                </section>
              ) : null}
            </div>
          )}
        </DialogContent>
        <DialogFooter className="mt-0">
          <Button
            type="button"
            variant="secondary"
            disabled={!value && draftSourceIds.length === 0 && !query}
            onClick={() => {
              setDraftSourceIds([]);
              setQuery("");
              onChange(null);
            }}
            className="mr-auto gap-1.5"
          >
            <RotateCcw className="size-3.5" aria-hidden />
            Reset
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!sourceTarget}
            onClick={() => {
              if (sourceTarget) {
                onChange(sourceTarget);
                setOpen(false);
              }
            }}
          >
            Use {draftSourceIds.length || 0} source
            {draftSourceIds.length === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
