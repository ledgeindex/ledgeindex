import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getStore } from "../db/index.js";
import {
  isValidSourceSlug,
  normalizeSourceSlugInput,
  slugifySourceName,
} from "../lib/source-slug.js";
import { requireUser } from "../lib/resource-access.js";
import {
  getSourceSetSummary,
  listSourceSetSummaries,
  validateSourceIdsForUser,
} from "../services/source-set-summary.js";
import {
  assertCanCreateSourceSet,
  assertSourceIdsWithinSetLimit,
  ensureDefaultSourceSetForLimitedUser,
  getSourceSetLimitsForUser,
  SourceSetLimitError,
} from "../services/source-set-limits.js";

const createSourceSetBodySchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(64).optional(),
  description: z.string().max(2000).nullable().optional(),
  sourceIds: z.array(z.string().uuid()).default([]),
});

const updateSourceSetBodySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  slug: z.string().min(1).max(64).optional(),
  description: z.string().max(2000).nullable().optional(),
  sourceIds: z.array(z.string().uuid()).optional(),
});

export async function sourceSetRoutes(fastify: FastifyInstance) {
  fastify.get("/api/source-sets", async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return;

    await ensureDefaultSourceSetForLimitedUser(userId);
    const [sourceSets, limits] = await Promise.all([
      listSourceSetSummaries(userId),
      getSourceSetLimitsForUser(userId),
    ]);
    return { sourceSets, meta: { limits } };
  });

  fastify.post("/api/source-sets", async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return;

    const body = createSourceSetBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: body.error.flatten() });
    }

    const slug = normalizeSourceSlugInput(
      body.data.slug ?? slugifySourceName(body.data.name),
    );
    if (!isValidSourceSlug(slug)) {
      return reply.status(400).send({
        error: "Slug must use lowercase letters, numbers, and hyphens",
      });
    }

    try {
      await assertCanCreateSourceSet(userId);
    } catch (error) {
      if (error instanceof SourceSetLimitError) {
        return reply.status(403).send({
          error: "Source set limit reached",
          message: error.message,
          code: error.code,
          current: error.current,
          limit: error.limit,
        });
      }
      throw error;
    }

    const sourceIds = await validateSourceIdsForUser(body.data.sourceIds, userId);
    try {
      await assertSourceIdsWithinSetLimit(userId, sourceIds);
    } catch (error) {
      if (error instanceof SourceSetLimitError) {
        return reply.status(403).send({
          error: "Source limit reached",
          message: error.message,
          code: error.code,
          current: error.current,
          limit: error.limit,
        });
      }
      throw error;
    }

    const sourceSet = await getStore().createSourceSet({
      ownerUserId: userId,
      name: body.data.name,
      slug,
      description: body.data.description ?? null,
      sourceIds,
    });

    const summary = await getSourceSetSummary(sourceSet, userId);
    return reply.status(201).send({ sourceSet: summary });
  });

  fastify.get("/api/source-sets/:id", async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return;

    const { id } = request.params as { id: string };
    const sourceSet =
      (await getStore().getSourceSet(id)) ??
      (await getStore().getSourceSetBySlug(userId, id));
    if (!sourceSet || sourceSet.ownerUserId !== userId) {
      return reply.status(404).send({ error: "Source set not found" });
    }

    const summary = await getSourceSetSummary(sourceSet, userId);
    return { sourceSet: summary };
  });

  fastify.put("/api/source-sets/:id", async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return;

    const { id } = request.params as { id: string };
    const existing =
      (await getStore().getSourceSet(id)) ??
      (await getStore().getSourceSetBySlug(userId, id));
    if (!existing || existing.ownerUserId !== userId) {
      return reply.status(404).send({ error: "Source set not found" });
    }

    const body = updateSourceSetBodySchema.safeParse(request.body);
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

    const sourceIds =
      body.data.sourceIds !== undefined
        ? await validateSourceIdsForUser(body.data.sourceIds, userId)
        : undefined;

    if (sourceIds !== undefined) {
      try {
        await assertSourceIdsWithinSetLimit(userId, sourceIds);
      } catch (error) {
        if (error instanceof SourceSetLimitError) {
          return reply.status(403).send({
            error: "Source limit reached",
            message: error.message,
            code: error.code,
            current: error.current,
            limit: error.limit,
          });
        }
        throw error;
      }
    }

    const sourceSet = await getStore().updateSourceSet(existing.id, {
      ...body.data,
      sourceIds,
    });
    if (!sourceSet) {
      return reply.status(404).send({ error: "Source set not found" });
    }

    const summary = await getSourceSetSummary(sourceSet, userId);
    return { sourceSet: summary };
  });

  fastify.delete("/api/source-sets/:id", async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return;

    const { id } = request.params as { id: string };
    const existing =
      (await getStore().getSourceSet(id)) ??
      (await getStore().getSourceSetBySlug(userId, id));
    if (!existing || existing.ownerUserId !== userId) {
      return reply.status(404).send({ error: "Source set not found" });
    }

    const deleted = await getStore().deleteSourceSet(existing.id);
    if (!deleted) {
      return reply.status(404).send({ error: "Source set not found" });
    }
    return { deleted: true, sourceSetId: existing.id };
  });
}
