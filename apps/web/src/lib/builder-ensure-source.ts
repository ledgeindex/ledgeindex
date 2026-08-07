import {
  createProject,
  createSource,
  getSource,
  KnowledgeIndexApiError,
  updateSource,
  type SourceMetadata,
  type WebCrawlConfig,
} from "@/lib/ledgeindex-api";
import { getDevProjectId, setDevProjectId } from "@/lib/dev-project";
import {
  builderStartUrl,
  type SourceBuilderDraft,
} from "@/lib/source-builder-draft";

export function builderSourceConfig(startUrl: string): WebCrawlConfig {
  return {
    startUrls: [startUrl],
    includePatterns: [],
    excludePatterns: [],
    excludeDownloadPatterns: [],
    patternsAreRegex: false,
    renderJs: false,
    useProxy: false,
    enableSitemap: false,
    sitemapOnly: false,
    sitemapUrls: [],
    fileTypes: ["html"],
    contentSelectors: [],
    excludeSelectors: [],
    maxPages: 1000,
    userAgent: "LedgeIndexBot/1.0 (+https://ledgeindex.ai)",
  };
}

export function defaultBuilderMetadata(
  versionLabel: string,
  docsIdentity?: SourceMetadata["docsIdentity"],
): SourceMetadata {
  return {
    sourceType: "documentation",
    sourceTypeConfidence: 1,
    origin: "internal",
    version: versionLabel,
    versionSource: "user",
    detectedSignals: ["source-builder"],
    ...(docsIdentity ? { docsIdentity } : {}),
  };
}

async function ensureProjectId(): Promise<string> {
  const existing = getDevProjectId();
  if (existing) return existing;
  const { project } = await createProject("My LedgeIndex project");
  setDevProjectId(project.id);
  return project.id;
}

/**
 * Create or update the LedgeIndex source linked to a builder draft.
 * Preserves existing docsIdentity when updating.
 */
export async function ensureBuilderLinkedSource(
  draft: SourceBuilderDraft,
  metadata?: SourceMetadata | null,
  options?: { hosting?: "local" | "cloud" },
): Promise<{ sourceId: string; sourceMetadata: SourceMetadata }> {
  const startUrl = builderStartUrl(draft);
  const config = builderSourceConfig(startUrl);
  const baseMetadata =
    metadata ??
    defaultBuilderMetadata(
      draft.versionLabel,
      draft.sourceMetadata?.docsIdentity,
    );
  const hosting =
    options?.hosting ??
    draft.preferredHosting ??
    "local";

  if (draft.linkedSourceId) {
    try {
      const { source } = await getSource(draft.linkedSourceId);
      const nextMetadata: SourceMetadata = {
        ...baseMetadata,
        docsIdentity:
          baseMetadata.docsIdentity ?? source.sourceMetadata?.docsIdentity,
      };
      await updateSource(draft.linkedSourceId, {
        name: draft.name,
        config,
        sourceMetadata: nextMetadata,
      });
      return {
        sourceId: draft.linkedSourceId,
        sourceMetadata: nextMetadata,
      };
    } catch (error) {
      if (!(error instanceof KnowledgeIndexApiError) || error.status !== 404) {
        throw error;
      }
    }
  }

  const projectId = await ensureProjectId();
  try {
    const { source } = await createSource({
      projectId,
      name: draft.name,
      scope: "personal",
      hosting,
      versionMode: "new",
      versionLabel: draft.versionLabel,
      config,
      sourceMetadata: baseMetadata,
    });
    return { sourceId: source.id, sourceMetadata: baseMetadata };
  } catch (error) {
    if (
      error instanceof KnowledgeIndexApiError &&
      error.status === 404 &&
      projectId
    ) {
      const { project } = await createProject("My LedgeIndex project");
      setDevProjectId(project.id);
      const { source } = await createSource({
        projectId: project.id,
        name: draft.name,
        scope: "personal",
        hosting,
        versionLabel: draft.versionLabel,
        config,
        sourceMetadata: baseMetadata,
      });
      return { sourceId: source.id, sourceMetadata: baseMetadata };
    }
    throw error;
  }
}
