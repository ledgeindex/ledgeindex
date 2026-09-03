import { getStore } from "../db/index.js";
import type { Source, SourceScope } from "../db/types.js";
import {
  defaultVersionLabel,
  normalizeCanonicalUrl,
} from "../lib/canonical-url.js";
import { slugOwnerKeyForSource } from "./source-resolve.js";
import { toSourceSummary } from "./source-summary.js";
import type { SourceSummary, SourceVersionSummary } from "../db/types.js";

export type SourceDuplicateMatch = {
  canonicalUrl: string;
  existing: SourceSummary;
  versions: SourceVersionSummary[];
  suggestedVersionNumber: number;
  suggestedVersionLabel: string;
};

export function isIndexedSourceVersion(source: Source): boolean {
  return (
    Boolean(source.indexedAt) ||
    (source.indexStats?.pageCount ?? 0) > 0 ||
    (source.indexStats?.chunkCount ?? 0) > 0
  );
}

export async function findSourceDuplicates(input: {
  startUrl: string;
  scope: SourceScope;
  ownerUserId: string | null;
  detectedVersion?: string | null;
  userVersionLabel?: string | null;
}): Promise<SourceDuplicateMatch | null> {
  const canonicalUrl = normalizeCanonicalUrl(input.startUrl);
  if (!canonicalUrl) return null;

  const slugOwnerKey = slugOwnerKeyForSource(input.scope, input.ownerUserId);
  const matches = await getStore().listSourcesByCanonicalUrl(
    canonicalUrl,
    input.scope,
    slugOwnerKey,
  );
  const indexedMatches = matches.filter(isIndexedSourceVersion);
  if (indexedMatches.length === 0) return null;

  const familyId =
    indexedMatches[0]?.sourceFamilyId ?? indexedMatches[0]?.id ?? null;
  const familySources = familyId
    ? (
        await getStore().listSourcesByFamilyId(familyId)
      ).filter(
        (source) =>
          source.scope === input.scope && isIndexedSourceVersion(source),
      )
    : indexedMatches;

  const sorted = [...familySources].sort(
    (a, b) => (b.versionNumber ?? 1) - (a.versionNumber ?? 1),
  );
  const latest = sorted[0]!;
  const maxVersion = Math.max(...sorted.map((s) => s.versionNumber ?? 1));
  const suggestedVersionNumber = maxVersion + 1;

  return {
    canonicalUrl,
    existing: toSourceSummary(latest),
    versions: await Promise.all(
      sorted.map(async (source) => {
        const summary = toSourceSummary(source);
        return {
          id: summary.id,
          versionNumber: summary.versionNumber,
          versionLabel: summary.versionLabel,
          indexedAt: summary.indexedAt,
          chunkCount: summary.chunkCount,
          pageCount: summary.pageCount,
        };
      }),
    ),
    suggestedVersionNumber,
    suggestedVersionLabel: defaultVersionLabel({
      versionNumber: suggestedVersionNumber,
      detectedVersion: input.detectedVersion,
      userLabel: input.userVersionLabel,
    }),
  };
}

export function resolveVersionFieldsForCreate(input: {
  startUrl: string;
  detectedVersion?: string | null;
  userVersionLabel?: string | null;
  versionMode?: "new" | "replace";
  replaceSource?: Source | null;
  familySources?: Source[];
}): {
  canonicalUrl: string;
  sourceFamilyId: string | null;
  versionNumber: number;
  versionLabel: string;
} {
  const canonicalUrl = normalizeCanonicalUrl(input.startUrl);
  const familySources = (input.familySources ?? []).filter(
    isIndexedSourceVersion,
  );

  if (input.versionMode === "replace" && input.replaceSource) {
    return {
      canonicalUrl: input.replaceSource.canonicalUrl ?? canonicalUrl,
      sourceFamilyId: input.replaceSource.sourceFamilyId ?? input.replaceSource.id,
      versionNumber: input.replaceSource.versionNumber ?? 1,
      versionLabel: defaultVersionLabel({
        versionNumber: input.replaceSource.versionNumber ?? 1,
        detectedVersion: input.detectedVersion ?? input.replaceSource.sourceMetadata?.version,
        userLabel:
          input.userVersionLabel ??
          input.replaceSource.versionLabel ??
          input.replaceSource.sourceMetadata?.version,
      }),
    };
  }

  const maxVersion = familySources.length
    ? Math.max(...familySources.map((s) => s.versionNumber ?? 1))
    : 0;
  const versionNumber = maxVersion + 1;
  const sourceFamilyId =
    familySources[0]?.sourceFamilyId ?? familySources[0]?.id ?? null;

  return {
    canonicalUrl,
    sourceFamilyId,
    versionNumber,
    versionLabel: defaultVersionLabel({
      versionNumber,
      detectedVersion: input.detectedVersion,
      userLabel: input.userVersionLabel,
    }),
  };
}
