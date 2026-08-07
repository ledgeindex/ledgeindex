import type { FastifyInstance } from "fastify";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { getEnrichModel } from "@ledgeindex/core";
import { profileRepo } from "@ledgeindex/repo";
import { logError, logInfo } from "../lib/logger.js";
import { requireUser } from "../lib/resource-access.js";

const profileRepoBodySchema = z.object({
  checkoutPath: z.string().min(1),
  githubUrl: z.string().optional(),
  libraryName: z.string().min(1).max(200).optional(),
  maxExamples: z.number().int().positive().max(8).optional(),
});

/**
 * Platform + AG: profile a local checkout (description, primitives, examples).
 * POST /api/repo/profile
 */
export async function repoProfileRoutes(fastify: FastifyInstance) {
  fastify.post("/api/repo/profile", async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return;

    const body = profileRepoBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: body.error.flatten() });
    }

    const checkoutPath = resolve(body.data.checkoutPath);
    if (!existsSync(checkoutPath)) {
      return reply
        .status(400)
        .send({ error: `Checkout path not found: ${checkoutPath}` });
    }

    let model;
    try {
      model = getEnrichModel();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Enrich model unavailable";
      return reply.status(503).send({ error: message });
    }

    try {
      logInfo("Repo profile started", "RepoProfile", {
        checkoutPath,
        libraryName: body.data.libraryName ?? null,
      });

      const result = await profileRepo({
        repoPath: checkoutPath,
        libraryName: body.data.libraryName,
        model,
        maxExamples: body.data.maxExamples,
      });

      return {
        ok: result.status === "profiled",
        githubUrl: body.data.githubUrl ?? null,
        ...result,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Repo profile failed";
      logError(error instanceof Error ? error : message, "RepoProfile", {
        checkoutPath,
      });
      return reply.status(500).send({ error: message });
    }
  });
}
