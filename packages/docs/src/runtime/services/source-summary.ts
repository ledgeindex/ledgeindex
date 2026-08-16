import { getStore } from "../db/index.js";
import type { Source, SourceSummary } from "../db/types.js";
import { resolveSourceHosting } from "../db/types.js";
import { defaultVersionLabel } from "../lib/canonical-url.js";

export function attachFamilyVersions(summaries: SourceSummary[]): SourceSummary[] {
  const byFamily = new Map<string, SourceSummary[]>();

  for (const summary of summaries) {
    const key = summary.sourceFamilyId ?? summary.id;
    const bucket = byFamily.get(key) ?? [];
    bucket.push(summary);
    byFamily.set(key, bucket);
  }

  return summaries.map((summary) => {
    const key = summary.sourceFamilyId ?? summary.id;
    const versions = (byFamily.get(key) ?? [summary])
      .map((entry) => ({
        id: entry.id,
        versionNumber: entry.versionNumber,
        versionLabel: entry.versionLabel,
        indexedAt: entry.indexedAt,
        chunkCount: entry.chunkCount,
        pageCount: entry.pageCount,
      }))
      .sort((a, b) => b.versionNumber - a.versionNumber);

    return { ...summary, versions };
  });
}

/**
 * Pure mapping — no I/O. List endpoints call this per row, so anything that
 * touches the catalog store here turns one query into an N+1.
 */
export function toSourceSummary(source: Source): SourceSummary {
  const startUrls = [...(source.config.startUrls ?? [])];
  const startUrl = startUrls[0] ?? "";
  const versionNumber = source.versionNumber ?? 1;
  const versionLabel =
    source.versionLabel ??
    defaultVersionLabel({
      versionNumber,
      detectedVersion: source.sourceMetadata?.version,
    });

  return {
    id: source.id,
    projectId: source.projectId,
    name: source.name,
    slug: source.slug,
    scope: source.scope ?? "personal",
    hosting: resolveSourceHosting({
      hosting: source.hosting,
      scope: source.scope,
      vectorBackend: source.indexStats?.vectorBackend,
    }),
    startUrl,
    startUrls,
    sourceType: source.sourceMetadata?.sourceType ?? "unknown",
    ogImageUrl: source.ogImageUrl ?? null,
    faviconUrl: source.faviconUrl ?? null,
    indexedAt: source.indexedAt ?? null,
    pageCount: source.indexStats?.pageCount ?? 0,
    chunkCount: source.indexStats?.chunkCount ?? 0,
    canonicalUrl: source.canonicalUrl ?? null,
    sourceFamilyId: source.sourceFamilyId ?? source.id,
    versionNumber,
    versionLabel,
    categories: source.categories ?? [],
    displayOrder:
      typeof source.displayOrder === "number" ? source.displayOrder : null,
    versions: [],
    excludePatterns: [...(source.config.excludePatterns ?? [])],
    includePatterns: [...(source.config.includePatterns ?? [])],
    hasSiteProfile: Boolean(source.sourceMetadata?.siteProfile?.lenses?.length),
    siteProfileLensCount: source.sourceMetadata?.siteProfile?.lenses?.length ?? 0,
  };
}

function mapSourceSummaries(sources: Source[]): SourceSummary[] {
  return attachFamilyVersions(sources.map(toSourceSummary));
}

export async function listAllSourceSummaries(): Promise<SourceSummary[]> {
  const sources = await getStore().listSources();
  return mapSourceSummaries(sources);
}

export async function listSourceSummariesForOwner(
  ownerUserId: string,
): Promise<SourceSummary[]> {
  const sources = await getStore().listPersonalSourcesForOwner(ownerUserId);
  return mapSourceSummaries(sources);
}

export async function listGlobalSourceSummaries(): Promise<SourceSummary[]> {
  const sources = await getStore().listGlobalSources();
  return mapSourceSummaries(sources);
}

export async function listSourceSummariesByScope(
  scope: Source["scope"],
  ownerUserId: string,
): Promise<SourceSummary[]> {
  if (scope === "global") {
    return listGlobalSourceSummaries();
  }
  return listSourceSummariesForOwner(ownerUserId);
}

export async function getSourceSummary(
  sourceId: string,
): Promise<SourceSummary | null> {
  const source = await getStore().getSource(sourceId);
  if (!source) return null;
  const summary = toSourceSummary(source);
  const family = await getStore().listSourcesByFamilyId(
    source.sourceFamilyId ?? source.id,
  );
  return attachFamilyVersions(family.map(toSourceSummary)).find(
    (entry) => entry.id === sourceId,
  ) ?? summary;
}
