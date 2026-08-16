import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { discoverUrls } from "../crawler/discover.js";
import { estimateChunkCountFromMarkdown } from "../indexing/index-size-estimate.js";
import { getStore } from "../db/index.js";
import type { SourceScope } from "../db/types.js";
import { normalizeCreateHosting } from "../db/types.js";
import { logError, logInfo, logVerbose } from "../lib/logger.js";
import { parsePage } from "../parser/extract-content.js";
import {
  getSourceSummary,
  listGlobalSourceSummaries,
  listSourceSummariesForOwner,
} from "../services/source-summary.js";
import { collectSourceCategoryOptions } from "../services/source-categories.js";
import { normalizeSourceCategories } from "../lib/source-category.js";
import { deleteSourceWithIndex } from "../services/delete-source.js";
import {
  createSourceBodySchema,
  webCrawlSourceConfigSchema,
} from "../schemas/source-config.js";
import {
  docsIdentitySchema,
  siteProfileSchema,
  sourceMetadataSchema,
  type DocsIdentity,
  type SourceMetadata,
} from "../schemas/source-metadata.js";
import {
  getProjectForUser,
  getRequestUserRole,
  getSourceForUser,
  getSourceForWrite,
  requireAdmin,
  requireUser,
} from "../lib/resource-access.js";
import { isApiAuthRequired } from "../lib/firebase-admin.js";
import {
  allocateSourceSlug,
  slugOwnerKeyForSource,
} from "../services/source-resolve.js";
import {
  findSourceDuplicates,
  resolveVersionFieldsForCreate,
} from "../services/source-versioning.js";
import { normalizeCanonicalUrl } from "../lib/canonical-url.js";
import {
  assertCanCreateSource,
  getAccountSourceLimitsForUser,
  SourceLimitError,
} from "../services/source-set-limits.js";
import {
  isValidSourceSlug,
  normalizeSourceSlugInput,
} from "../lib/source-slug.js";
const parsePreviewBodySchema = z.object({
  urls: z.array(z.string().url()).min(1).max(10),
  contentSelectors: z.array(z.string()).optional(),
  excludeSelectors: z.array(z.string()).optional(),
});

const listSourcesQuerySchema = z.object({
  scope: z.enum(["personal", "global", "all"]).default("all"),
});

const duplicateCheckQuerySchema = z.object({
  url: z.string().url(),
  scope: z.enum(["personal", "global"]).default("personal"),
  versionLabel: z.string().min(1).max(120).optional(),
});

export async function sourceRoutes(fastify: FastifyInstance) {
  fastify.get("/api/sources/duplicates", async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return;

    const query = duplicateCheckQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({ error: query.error.flatten() });
    }

    if (query.data.scope === "global" && !(await requireAdmin(request, reply))) {
      return;
    }

    const ownerUserId = query.data.scope === "global" ? null : userId;
    const duplicate = await findSourceDuplicates({
      startUrl: query.data.url,
      scope: query.data.scope,
      ownerUserId,
      userVersionLabel: query.data.versionLabel ?? null,
    });

    return { duplicate };
  });

  fastify.get("/api/sources/limits", async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return;

    const query = z
      .object({ scope: z.enum(["personal", "global"]).default("personal") })
      .safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({ error: query.error.flatten() });
    }

    if (query.data.scope === "global" && !(await requireAdmin(request, reply))) {
      return;
    }

    const limits = await getAccountSourceLimitsForUser(userId, query.data.scope);
    return { limits };
  });

  fastify.get("/api/sources", async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return;

    const query = listSourcesQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({ error: query.error.flatten() });
    }

    try {
      if (query.data.scope === "personal") {
        const [sources, limits] = await Promise.all([
          listSourceSummariesForOwner(userId),
          getAccountSourceLimitsForUser(userId, "personal"),
        ]);
        return { sources, meta: { limits } };
      }

      if (query.data.scope === "global") {
        const [sources, limits] = await Promise.all([
          listGlobalSourceSummaries(),
          getAccountSourceLimitsForUser(userId, "global"),
        ]);
        return { sources, meta: { limits } };
      }

      const [personal, global] = await Promise.all([
        listSourceSummariesForOwner(userId),
        listGlobalSourceSummaries(),
      ]);
      return { sources: [...global, ...personal] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const cloudDown =
        /ECONNREFUSED|5432|postgres|Cloud Postgres|CLOUD_POSTGRES/i.test(
          message,
        );
      if (cloudDown && query.data.scope !== "personal") {
        return reply.status(503).send({
          error:
            "Public sources need Cloud SQL Auth Proxy on :5432 (`cloud-sql-proxy … --port 5432`). Start it, then retry — or use Just me for local sources.",
          detail: message,
        });
      }
      throw error;
    }
  });

  fastify.get("/api/source-categories", async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return;

    const query = listSourcesQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({ error: query.error.flatten() });
    }

    let sources;
    if (query.data.scope === "personal") {
      sources = await listSourceSummariesForOwner(userId);
    } else if (query.data.scope === "global") {
      sources = await listGlobalSourceSummaries();
    } else {
      const [personal, global] = await Promise.all([
        listSourceSummariesForOwner(userId),
        listGlobalSourceSummaries(),
      ]);
      sources = [...global, ...personal];
    }

    return { categories: collectSourceCategoryOptions(sources) };
  });

  fastify.put("/api/sources/reorder", async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return;

    if (isApiAuthRequired() && !(await requireAdmin(request, reply))) {
      return;
    }

    const body = z
      .object({
        items: z
          .array(
            z.object({
              id: z.string().min(1),
              displayOrder: z.number().int().min(0).max(100_000),
            }),
          )
          .min(1)
          .max(500),
      })
      .safeParse(request.body);

    if (!body.success) {
      return reply.status(400).send({ error: body.error.flatten() });
    }

    const role = await getRequestUserRole(request);
    let updated = 0;

    for (const item of body.data.items) {
      const existing = await getSourceForWrite(item.id, userId, role);
      if (!existing) {
        return reply.status(404).send({
          error: `Source not found: ${item.id}`,
        });
      }

      const familyId = existing.sourceFamilyId ?? existing.id;
      const familySources = await getStore().listSourcesByFamilyId(familyId);
      const targetIds = [
        ...new Set([item.id, ...familySources.map((entry) => entry.id)]),
      ];

      for (const targetId of targetIds) {
        const next = await getStore().updateSource(targetId, {
          displayOrder: item.displayOrder,
          ...(!existing.sourceFamilyId ? { sourceFamilyId: familyId } : {}),
        });
        if (next) updated += 1;
      }
    }

    return { updated };
  });

  fastify.post("/api/sources", async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return;

    const body = createSourceBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: body.error.flatten() });
    }

    try {
    const scope: SourceScope = body.data.scope;
    let projectId = body.data.projectId;

    let ownerUserId: string | null = userId;
    if (scope === "global") {
      if (!(await requireAdmin(request, reply))) return;
      const platformProject = await getStore().getOrCreatePlatformProject();
      projectId = platformProject.id;
      ownerUserId = null;
    } else {
      if (!projectId) {
        return reply.status(400).send({ error: "projectId is required" });
      }
      const project = await getProjectForUser(projectId, userId);
      if (!project) {
        return reply.status(404).send({ error: "Project not found" });
      }
    }

    const slugOwnerKey = slugOwnerKeyForSource(scope, ownerUserId);
    const startUrl = body.data.config.startUrls[0] ?? "";
    const canonicalUrl = normalizeCanonicalUrl(startUrl);
    const familySources = canonicalUrl
      ? await getStore().listSourcesByCanonicalUrl(canonicalUrl, scope, slugOwnerKey)
      : [];

    if (body.data.versionMode === "replace" && body.data.replaceSourceId) {
      const existing = await getSourceForWrite(body.data.replaceSourceId, userId, await getRequestUserRole(request));
      if (!existing) {
        return reply.status(404).send({ error: "Source to replace not found" });
      }

      const versionFields = resolveVersionFieldsForCreate({
        startUrl,
        detectedVersion: body.data.sourceMetadata?.version,
        userVersionLabel: body.data.versionLabel,
        versionMode: "replace",
        replaceSource: existing,
        familySources,
      });

      const mergedMetadata = body.data.sourceMetadata
        ? {
            ...body.data.sourceMetadata,
            version: versionFields.versionLabel,
            versionSource: "user" as const,
          }
        : existing.sourceMetadata;

      const updated = await getStore().updateSource(existing.id, {
        name: body.data.name,
        config: body.data.config,
        sourceMetadata: mergedMetadata,
        canonicalUrl: versionFields.canonicalUrl,
        versionLabel: versionFields.versionLabel,
      });

      return reply.status(200).send({ source: updated, replaced: true });
    }

    const isNewSourceFamily = familySources.length === 0;
    if (isNewSourceFamily) {
      try {
        await assertCanCreateSource(userId, scope);
      } catch (error) {
        if (error instanceof SourceLimitError) {
          return reply.status(403).send({
            error: "Source limit reached",
            message: error.message,
            scope: error.scope,
            current: error.current,
            limit: error.limit,
          });
        }
        throw error;
      }
    }

    const versionFields = resolveVersionFieldsForCreate({
      startUrl,
      detectedVersion: body.data.sourceMetadata?.version,
      userVersionLabel: body.data.versionLabel,
      versionMode: "new",
      familySources,
    });

    const slug = await allocateSourceSlug({
      name: body.data.name,
      scope,
      ownerUserId,
      preferredSlug: body.data.slug,
    });

    const sourceMetadata = body.data.sourceMetadata
      ? {
          ...body.data.sourceMetadata,
          version: versionFields.versionLabel,
          versionSource: "user" as const,
        }
      : null;

    const source = await getStore().createSource({
      projectId: projectId!,
      name: body.data.name,
      slug,
      slugOwnerKey,
      scope,
      hosting: normalizeCreateHosting({
        scope,
        hosting: body.data.hosting,
      }),
      config: body.data.config,
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

    return reply.status(201).send({ source });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to create source";
      logError(error instanceof Error ? error : message, "CreateSource");
      return reply.status(500).send({ error: message });
    }
  });

  fastify.get("/api/sources/:id", async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return;

    const { id } = request.params as { id: string };
    const source = await getSourceForUser(id, userId);
    if (!source) {
      return reply.status(404).send({ error: "Source not found" });
    }
    return { source };
  });

  fastify.get("/api/sources/:id/summary", async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return;

    const { id } = request.params as { id: string };
    const source = await getSourceForUser(id, userId);
    if (!source) {
      return reply.status(404).send({ error: "Source not found" });
    }
    const summary = await getSourceSummary(source.id);
    return { summary };
  });

  fastify.put("/api/sources/:id/docs-identity", async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return;

    if (isApiAuthRequired() && !(await requireAdmin(request, reply))) {
      return;
    }

    const role = await getRequestUserRole(request);
    const { id } = request.params as { id: string };
    const existing = await getSourceForWrite(id, userId, role);
    if (!existing) {
      return reply.status(404).send({ error: "Source not found" });
    }

    const body = docsIdentitySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: body.error.flatten() });
    }

    const prev = existing.sourceMetadata;
    const nextMetadata: SourceMetadata = {
      sourceType: prev?.sourceType ?? "documentation",
      sourceTypeConfidence: prev?.sourceTypeConfidence ?? 0.5,
      origin: prev?.origin ?? "external",
      version: prev?.version ?? null,
      versionSource: prev?.versionSource ?? null,
      detectedSignals: prev?.detectedSignals ?? [],
      llmsTxt: prev?.llmsTxt ?? null,
      ...prev,
      docsIdentity: {
        ...body.data,
        updatedAt: new Date().toISOString(),
      },
    };

    const source = await getStore().updateSource(id, {
      sourceMetadata: nextMetadata,
    });
    if (!source) {
      return reply.status(404).send({ error: "Source not found" });
    }
    return { source, docsIdentity: nextMetadata.docsIdentity };
  });

  fastify.put("/api/sources/:id/site-profile", async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return;

    if (isApiAuthRequired() && !(await requireAdmin(request, reply))) {
      return;
    }

    const role = await getRequestUserRole(request);
    const { id } = request.params as { id: string };
    const existing = await getSourceForWrite(id, userId, role);
    if (!existing) {
      return reply.status(404).send({ error: "Source not found" });
    }

    const body = siteProfileSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: body.error.flatten() });
    }

    const prev = existing.sourceMetadata;
    const now = new Date().toISOString();
    const nextSiteProfile = {
      ...body.data,
      updatedAt: now,
      generatedAt: body.data.generatedAt ?? now,
    };

    const docsIdentityFromLens = (() => {
      const raw = nextSiteProfile.profile?.docs_identity;
      if (!raw || typeof raw !== "object") return prev?.docsIdentity;
      const lens = raw as {
        overallSummary?: string;
        kind?: DocsIdentity["kind"];
        language?: DocsIdentity["language"];
      };
      if (!lens.overallSummary?.trim() && !lens.kind && !lens.language) {
        return prev?.docsIdentity;
      }
      return {
        overallSummary: lens.overallSummary?.trim() || prev?.docsIdentity?.overallSummary,
        kind: lens.kind ?? prev?.docsIdentity?.kind,
        language: lens.language ?? prev?.docsIdentity?.language,
        paths: prev?.docsIdentity?.paths ?? [],
        generatedAt: now,
        updatedAt: now,
      };
    })();

    const nextMetadata: SourceMetadata = {
      sourceType: prev?.sourceType ?? "documentation",
      sourceTypeConfidence: prev?.sourceTypeConfidence ?? 0.5,
      origin: prev?.origin ?? "external",
      version: prev?.version ?? null,
      versionSource: prev?.versionSource ?? null,
      detectedSignals: prev?.detectedSignals ?? [],
      llmsTxt: prev?.llmsTxt ?? null,
      ...prev,
      siteProfile: nextSiteProfile,
      ...(docsIdentityFromLens ? { docsIdentity: docsIdentityFromLens } : {}),
    };

    const source = await getStore().updateSource(id, {
      sourceMetadata: nextMetadata,
    });
    if (!source) {
      return reply.status(404).send({ error: "Source not found" });
    }
    return { source, siteProfile: nextMetadata.siteProfile };
  });

  fastify.delete("/api/sources/:id/site-profile", async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return;

    if (isApiAuthRequired() && !(await requireAdmin(request, reply))) {
      return;
    }

    const role = await getRequestUserRole(request);
    const { id } = request.params as { id: string };
    const existing = await getSourceForWrite(id, userId, role);
    if (!existing) {
      return reply.status(404).send({ error: "Source not found" });
    }

    const prev = existing.sourceMetadata;
    const nextMetadata: SourceMetadata = {
      sourceType: prev?.sourceType ?? "documentation",
      sourceTypeConfidence: prev?.sourceTypeConfidence ?? 0.5,
      origin: prev?.origin ?? "external",
      version: prev?.version ?? null,
      versionSource: prev?.versionSource ?? null,
      detectedSignals: prev?.detectedSignals ?? [],
      llmsTxt: prev?.llmsTxt ?? null,
      ...prev,
    };
    delete nextMetadata.siteProfile;

    const source = await getStore().updateSource(id, {
      sourceMetadata: nextMetadata,
    });
    if (!source) {
      return reply.status(404).send({ error: "Source not found" });
    }
    return { source, deleted: true };
  });

  fastify.put("/api/sources/:id", async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return;

    const role = await getRequestUserRole(request);
    const { id } = request.params as { id: string };
    const existing = await getSourceForWrite(id, userId, role);
    if (!existing) {
      return reply.status(404).send({ error: "Source not found" });
    }

    const body = z
      .object({
        name: z.string().min(1).max(200).optional(),
        slug: z.string().min(1).max(64).optional(),
        config: webCrawlSourceConfigSchema.optional(),
        ogImageUrl: z.string().url().nullable().optional(),
        faviconUrl: z.string().url().nullable().optional(),
        sourceMetadata: sourceMetadataSchema.nullable().optional(),
        categories: z.array(z.string().min(1).max(48)).max(12).optional(),
        displayOrder: z.number().int().min(0).max(100_000).nullable().optional(),
      })
      .safeParse(request.body);

    if (!body.success) {
      return reply.status(400).send({ error: body.error.flatten() });
    }

    if (body.data.slug) {
      const normalized = normalizeSourceSlugInput(body.data.slug);
      if (!isValidSourceSlug(normalized)) {
        return reply.status(400).send({
          error: "Slug must use lowercase letters, numbers, and hyphens",
        });
      }
      body.data.slug = normalized;
    }

    const slugOwnerKey =
      existing.scope === "global"
        ? slugOwnerKeyForSource("global", null)
        : slugOwnerKeyForSource("personal", userId);

    const normalizedCategories =
      body.data.categories !== undefined
        ? normalizeSourceCategories(body.data.categories)
        : undefined;

    if (
      (normalizedCategories !== undefined ||
        body.data.displayOrder !== undefined) &&
      isApiAuthRequired() &&
      !(await requireAdmin(request, reply))
    ) {
      return;
    }

    const familyId = existing.sourceFamilyId ?? existing.id;
    const familySources = await getStore().listSourcesByFamilyId(familyId);
    // Always include the current source. Older rows may have null source_family_id,
    // so the family query can return [] even though `existing` was found.
    const familyWide =
      normalizedCategories !== undefined || body.data.displayOrder !== undefined;
    const targetIds = familyWide
      ? [
          ...new Set([
            id,
            ...familySources.map((entry) => entry.id),
          ]),
        ]
      : [id];

    let source = null;
    for (const targetId of targetIds) {
      source = await getStore().updateSource(targetId, {
        ...body.data,
        ...(normalizedCategories !== undefined
          ? { categories: normalizedCategories }
          : {}),
        slugOwnerKey,
        // Backfill family id so later shelf edits hit the whole family.
        ...(familyWide && !existing.sourceFamilyId
          ? { sourceFamilyId: familyId }
          : {}),
      });
    }

    if (!source) {
      return reply.status(404).send({ error: "Source not found" });
    }
    const summary = await getSourceSummary(source.id);
    return { source: summary ?? source };
  });

  fastify.delete("/api/sources/:id", async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return;

    const role = await getRequestUserRole(request);
    const { id } = request.params as { id: string };
    const existing = await getSourceForWrite(id, userId, role);
    if (!existing) {
      return reply.status(404).send({ error: "Source not found" });
    }

    const deleted = await deleteSourceWithIndex(id);
    if (!deleted) {
      return reply.status(404).send({ error: "Source not found" });
    }
    return { deleted: true, sourceId: id };
  });

  fastify.post("/api/sources/:id/crawl-preview", async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return;

    const role = await getRequestUserRole(request);
    const { id } = request.params as { id: string };
    const source = await getSourceForWrite(id, userId, role);
    if (!source) {
      return reply.status(404).send({ error: "Source not found" });
    }

    const run = await getStore().createCrawlRun({
      sourceId: id,
      kind: "preview",
    });

    await getStore().updateCrawlRun(run.id, {
      status: "running",
      startedAt: new Date().toISOString(),
    });

    try {
      logInfo("Crawl preview started", "CrawlPreview", {
        sourceId: id,
        startUrls: source.config.startUrls,
        maxPages: source.config.maxPages,
      });

      const result = await discoverUrls(source.config);
      const updated = await getStore().updateCrawlRun(run.id, {
        status: "completed",
        pagesDiscovered: result.urls.length,
        result,
        finishedAt: new Date().toISOString(),
      });

      logInfo("Crawl preview completed", "CrawlPreview", {
        sourceId: id,
        crawlRunId: run.id,
        pagesDiscovered: result.urls.length,
        skipped: result.skipped.length,
      });

      return reply.status(202).send({ crawlRun: updated });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Crawl preview failed";
      logError(error instanceof Error ? error : message, "CrawlPreview", {
        sourceId: id,
        crawlRunId: run.id,
      });
      const updated = await getStore().updateCrawlRun(run.id, {
        status: "failed",
        error: message,
        finishedAt: new Date().toISOString(),
      });
      return reply.status(500).send({ crawlRun: updated, error: message });
    }
  });

  fastify.post("/api/sources/:id/parse-preview", async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return;

    const role = await getRequestUserRole(request);
    const { id } = request.params as { id: string };
    const source = await getSourceForWrite(id, userId, role);
    if (!source) {
      return reply.status(404).send({ error: "Source not found" });
    }

    const body = parsePreviewBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: body.error.flatten() });
    }

    const contentSelectors =
      body.data.contentSelectors ?? source.config.contentSelectors;
    const excludeSelectors =
      body.data.excludeSelectors ?? source.config.excludeSelectors;

    const pages = [];
    logVerbose("Parse preview started", "ParsePreview", {
      sourceId: id,
      urlCount: body.data.urls.length,
    });

    for (const url of body.data.urls) {
      try {
        const parsed = await parsePage(
          url,
          contentSelectors,
          excludeSelectors,
          source.config.userAgent,
        );
        const markdown = parsed.markdown.trim();
        pages.push({
          ...parsed,
          charCount: markdown.length,
          estimatedChunks: estimateChunkCountFromMarkdown(markdown),
        });
      } catch (error) {
        pages.push({
          url,
          title: url,
          markdown: "",
          error:
            error instanceof Error ? error.message : "Failed to parse page",
        });
      }
    }

    logInfo("Parse preview completed", "ParsePreview", {
      sourceId: id,
      pageCount: pages.length,
    });

    return { pages };
  });
}
