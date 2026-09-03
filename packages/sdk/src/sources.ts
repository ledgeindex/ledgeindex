import type { WebCrawlSourceConfig } from "@ledgeindex/core/schemas/source-config.js";
import type {
  SourceMetadata,
  SourceScope,
} from "@ledgeindex/docs/runtime/db/types.js";
import { getStore } from "@ledgeindex/docs/runtime/db/index.js";
import { normalizeCreateHosting } from "@ledgeindex/docs/runtime/db/types.js";
import { normalizeCanonicalUrl } from "@ledgeindex/docs/runtime/lib/canonical-url.js";
import {
  allocateSourceSlug,
  slugOwnerKeyForSource,
} from "@ledgeindex/docs/runtime/services/source-resolve.js";
import { assertCanCreateSource } from "@ledgeindex/docs/runtime/services/source-set-limits.js";
import { listSourceSummariesForOwner } from "@ledgeindex/docs/runtime/services/source-summary.js";
import { resolveVersionFieldsForCreate } from "@ledgeindex/docs/runtime/services/source-versioning.js";
import { getLocalUserId } from "./runtime.js";

const DEFAULT_PROJECT_NAME = "LedgeIndex";

async function getOrCreateProject(ownerUserId: string) {
  const projects = await getStore().listProjects(ownerUserId);
  if (projects.length > 0) {
    return projects[0]!;
  }
  return getStore().createProject(DEFAULT_PROJECT_NAME, ownerUserId);
}

export async function listSources() {
  return listSourceSummariesForOwner(getLocalUserId());
}

export async function resolveSourceRef(
  token: string,
  options: { version?: string } = {}
): Promise<{
  sourceId: string;
  name: string;
  slug: string;
  versionNumber: number;
  versionLabel: string;
}> {
  const sources = await listSources();
  const needle = token.toLowerCase();
  const familyMatch =
    sources.find((source) => source.slug.toLowerCase() === needle) ??
    sources.find((source) => source.name.toLowerCase() === needle) ??
    sources.find((source) => source.name.toLowerCase().includes(needle)) ??
    sources.find((source) => source.id === token);

  if (!familyMatch) {
    throw new Error(`No source matching "${token}". Use source id or slug.`);
  }

  const requestedVersion = options.version?.trim();
  if (!requestedVersion) {
    return {
      sourceId: familyMatch.id,
      name: familyMatch.name,
      slug: familyMatch.slug,
      versionNumber: familyMatch.versionNumber,
      versionLabel: familyMatch.versionLabel,
    };
  }

  const versionNeedle = requestedVersion.toLowerCase();
  const version = familyMatch.versions.find(
    (candidate) => candidate.versionLabel.toLowerCase() === versionNeedle
  );
  if (!version) {
    const available = familyMatch.versions
      .map((candidate) => candidate.versionLabel)
      .join(", ");
    throw new Error(
      `Source "${familyMatch.slug}" has no version "${requestedVersion}". Available versions: ${available || "none"}.`
    );
  }

  const selectedSource =
    sources.find((source) => source.id === version.id) ?? familyMatch;
  return {
    sourceId: version.id,
    name: selectedSource.name,
    slug: selectedSource.slug,
    versionNumber: version.versionNumber,
    versionLabel: version.versionLabel,
  };
}

export async function createWebCrawlSource(input: {
  name: string;
  slug?: string;
  scope?: SourceScope;
  config: WebCrawlSourceConfig;
  sourceMetadata?: SourceMetadata | null;
}) {
  const ownerUserId = getLocalUserId();
  const scope: SourceScope = input.scope ?? "personal";
  let projectId: string;
  let slugOwnerUserId: string | null = ownerUserId;

  if (scope === "global") {
    const platformProject = await getStore().getOrCreatePlatformProject();
    projectId = platformProject.id;
    slugOwnerUserId = null;
  } else {
    const project = await getOrCreateProject(ownerUserId);
    projectId = project.id;
  }

  const slugOwnerKey = slugOwnerKeyForSource(scope, slugOwnerUserId);
  const startUrl = input.config.startUrls[0] ?? "";
  const canonicalUrl = normalizeCanonicalUrl(startUrl);
  const familySources = canonicalUrl
    ? await getStore().listSourcesByCanonicalUrl(
        canonicalUrl,
        scope,
        slugOwnerKey
      )
    : [];

  const isNewSourceFamily = familySources.length === 0;
  if (isNewSourceFamily && slugOwnerUserId) {
    await assertCanCreateSource(slugOwnerUserId, scope);
  }

  const versionFields = resolveVersionFieldsForCreate({
    startUrl,
    detectedVersion: input.sourceMetadata?.version,
    versionMode: "new",
    familySources,
  });

  const slug = await allocateSourceSlug({
    name: input.name,
    scope,
    ownerUserId: slugOwnerUserId,
    preferredSlug: input.slug,
  });

  const sourceMetadata = input.sourceMetadata
    ? {
        ...input.sourceMetadata,
        version: versionFields.versionLabel,
        versionSource: "user" as const,
      }
    : null;

  const source = await getStore().createSource({
    projectId,
    name: input.name,
    slug,
    slugOwnerKey,
    scope,
    hosting: normalizeCreateHosting({ scope, hosting: undefined }),
    config: input.config,
    sourceMetadata,
    canonicalUrl: versionFields.canonicalUrl,
    sourceFamilyId: versionFields.sourceFamilyId ?? undefined,
    versionNumber: versionFields.versionNumber,
    versionLabel: versionFields.versionLabel,
  });

  if (!versionFields.sourceFamilyId) {
    await getStore().updateSource(source.id, {
      sourceFamilyId: source.id,
    });
  }

  return source;
}

export async function updateWebCrawlSource(
  sourceId: string,
  input: {
    name?: string;
    config?: WebCrawlSourceConfig;
    ogImageUrl?: string | null;
    faviconUrl?: string | null;
    sourceMetadata?: SourceMetadata | null;
  }
) {
  const updated = await getStore().updateSource(sourceId, input);
  if (!updated) {
    throw new Error(`Source not found: ${sourceId}`);
  }
  return updated;
}
