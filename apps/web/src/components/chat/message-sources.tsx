import { Sources } from "@/components/ai-elements/sources";
import {
  SourceBadgeFavicon,
  SourceOriginBadge,
  sourceOriginLabel,
} from "@/components/chat/chat-picked-source-badges";
import {
  collectMessageCitationSources,
  type CitationSource,
} from "@/lib/message-citation-sources";
import {
  readRetrievalFromParts,
  type RetrievalPickedSource,
} from "@/lib/retrieval-meta";
import type { UIMessage } from "ai";

function hostOf(url: string | null | undefined): string | null {
  if (!url?.trim()) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function matchPickedSource(
  source: CitationSource,
  picked: readonly RetrievalPickedSource[],
): RetrievalPickedSource | null {
  const catalog = source.catalogName?.trim().toLowerCase();
  if (catalog) {
    const byName = picked.find(
      (item) =>
        item.name.trim().toLowerCase() === catalog ||
        item.slug.trim().toLowerCase() === catalog,
    );
    if (byName) return byName;
  }

  const sourceHost = hostOf(source.url);
  if (!sourceHost) return null;
  return (
    picked.find((item) => {
      const startHost = hostOf(item.startUrl);
      return Boolean(startHost && (sourceHost === startHost || sourceHost.endsWith(`.${startHost}`) || startHost.endsWith(`.${sourceHost}`)));
    }) ?? null
  );
}

type CatalogGroup = {
  key: string;
  picked: RetrievalPickedSource | null;
  label: string;
  sources: CitationSource[];
};

function groupSourcesByCatalog(
  sources: CitationSource[],
  picked: readonly RetrievalPickedSource[],
): CatalogGroup[] {
  if (sources.length === 0) return [];

  const groups = new Map<string, CatalogGroup>();
  const order: string[] = [];

  const ensureGroup = (
    key: string,
    label: string,
    pickedSource: RetrievalPickedSource | null,
  ) => {
    const existing = groups.get(key);
    if (existing) return existing;
    const group: CatalogGroup = {
      key,
      label,
      picked: pickedSource,
      sources: [],
    };
    groups.set(key, group);
    order.push(key);
    return group;
  };

  // Prefer picked-source order so Mastra / Kapa stay stable.
  for (const item of picked) {
    ensureGroup(item.id, item.name, item);
  }

  for (const source of sources) {
    const matched = matchPickedSource(source, picked);
    if (matched) {
      ensureGroup(matched.id, matched.name, matched).sources.push(source);
      continue;
    }

    const catalogLabel = source.catalogName?.trim();
    if (catalogLabel) {
      const key = `catalog:${catalogLabel.toLowerCase()}`;
      ensureGroup(key, catalogLabel, null).sources.push(source);
      continue;
    }

    ensureGroup("other", "Other", null).sources.push(source);
  }

  return order
    .map((key) => groups.get(key)!)
    // Keep picked catalog chips even when citation URLs didn't match the group.
    .filter((group) => group.sources.length > 0 || Boolean(group.picked));
}

function SourceLinks({
  sources,
  as = "p",
}: {
  sources: CitationSource[];
  as?: "p" | "span";
}) {
  const Tag = as;
  return (
    <Tag className="min-w-0 text-xs leading-relaxed break-words text-muted">
      {sources.map((source, index) => (
        <span key={source.url}>
          {index > 0 ? <span className="text-muted">, </span> : null}
          <a
            href={source.url}
            target="_blank"
            rel="noreferrer"
            className="text-foreground underline-offset-2 transition-colors hover:text-accent hover:underline"
            title={source.url}
          >
            {source.title}
          </a>
        </span>
      ))}
    </Tag>
  );
}

export function MessageSources({
  parts,
  role,
}: {
  parts: UIMessage["parts"];
  role: UIMessage["role"];
}) {
  if (role !== "assistant") return null;

  const sources = collectMessageCitationSources(parts);
  const pickedSources = readRetrievalFromParts(parts)?.pickedSources ?? [];
  const groups = groupSourcesByCatalog(sources, pickedSources);
  // Always use catalog chips (with Local/Remote) when we have groups — even for one source.
  const useGroupedLayout = groups.length > 0;

  if (sources.length === 0 && pickedSources.length === 0) return null;

  return (
    <Sources className="mb-0 mt-1">
      {useGroupedLayout ? (
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium text-muted-strong">Sources</span>
            {groups.map((group) => (
              <div
                key={group.key}
                className="inline-flex w-fit max-w-full items-center gap-1.5 rounded-full border border-border bg-card-solid px-2 py-0.5 text-[11px] font-medium text-foreground shadow-card"
              >
                {group.picked ? (
                  <SourceBadgeFavicon source={group.picked} />
                ) : (
                  <span
                    className="inline-flex size-3.5 shrink-0 items-center justify-center rounded-sm bg-surface-raised font-mono text-[0.4375rem] font-semibold text-muted"
                    aria-hidden
                  >
                    {group.label.slice(0, 2).toUpperCase()}
                  </span>
                )}
                <span className="max-w-[9rem] truncate">{group.label}</span>
                {group.picked ? (
                  <SourceOriginBadge source={group.picked} />
                ) : null}
              </div>
            ))}
          </div>
          {groups.map((group) =>
            group.sources.length > 0 ? (
              <SourceLinks key={`${group.key}-links`} sources={group.sources} />
            ) : null,
          )}
        </div>
      ) : (
        <div className="flex min-w-0 flex-col gap-1.5">
          {pickedSources.length > 0 ? (
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <span className="text-xs font-medium text-muted-strong">Sources</span>
              {pickedSources.map((source) => {
                const origin = sourceOriginLabel(source);
                return (
                  <div
                    key={source.id}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-card-solid px-2 py-0.5 text-[11px] font-medium text-foreground shadow-card"
                    title={
                      origin ? `${source.slug} · ${origin}` : source.slug
                    }
                  >
                    <SourceBadgeFavicon source={source} />
                    <span className="max-w-[9rem] truncate">{source.name}</span>
                    <SourceOriginBadge source={source} />
                  </div>
                );
              })}
            </div>
          ) : sources.length > 0 ? (
            <p className="min-w-0 text-xs leading-relaxed break-words text-muted">
              <span className="font-medium text-muted-strong">Sources: </span>
              <SourceLinks sources={sources} as="span" />
            </p>
          ) : null}
        </div>
      )}
    </Sources>
  );
}
