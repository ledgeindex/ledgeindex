import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  getLandscapeRun,
  LandscapeRunSchema,
  runCompanyLandscape,
} from "../exa-landscape.js";
import {
  RESEARCH_LENSES,
  researchLensIds,
  researchLensSchema,
} from "../research/research-lenses.js";
import {
  getSiteProfileRun,
  startSiteProfileRun,
} from "../site-profile-runs.js";
import { normalizeProfileModelSelection } from "../research/profile-model.js";

const CreateRunBody = z.object({
  query: z.string().min(1),
  deep: z.boolean().optional(),
  userLocation: z.string().optional(),
});

const modelSelectionSchema = z
  .object({
    backend: z.string().min(1).optional(),
    modelId: z.string().min(1).optional(),
    baseUrl: z.string().min(1).optional(),
    googleModelId: z.string().min(1).optional(),
  })
  .optional();

const seedCatalogPageSchema = z.object({
  url: z.string().url(),
  title: z.string().min(1).max(500),
  markdown: z.string().max(120_000).optional(),
});

const CreateSiteProfileRunBody = z.object({
  url: z.string().url(),
  lenses: z.array(researchLensSchema).min(1).optional(),
  maxPages: z.number().int().positive().max(500).optional(),
  sitemapOnly: z.boolean().optional(),
  /** When set, skip crawl and pick from these pages (builder / seeded catalog). */
  seedPages: z.array(seedCatalogPageSchema).min(1).max(200).optional(),
  model: modelSelectionSchema,
  backend: z.string().optional(),
  modelId: z.string().optional(),
  baseUrl: z.string().optional(),
  googleModelId: z.string().optional(),
});

export async function registerProfile(fastify: FastifyInstance): Promise<void> {
  fastify.get("/api/profile/health", async () => ({
    profile: "profile",
    status: "ok",
  }));

  fastify.get("/api/profile/lenses", async () => ({
    lenses: researchLensIds.map((id) => ({
      id,
      label: RESEARCH_LENSES[id].label,
    })),
  }));

  fastify.post("/api/profile/site-runs", async (request, reply) => {
    const parsed = CreateSiteProfileRunBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const model = normalizeProfileModelSelection(parsed.data);

    const run = startSiteProfileRun({
      rootUrl: parsed.data.url,
      lenses: parsed.data.lenses ?? [...researchLensIds],
      maxPages: parsed.data.maxPages,
      sitemapOnly: parsed.data.sitemapOnly,
      model,
      seedPages: parsed.data.seedPages,
    });
    return reply.status(202).send({ run });
  });

  fastify.get("/api/profile/site-runs/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const run = getSiteProfileRun(id);
    if (!run) {
      return reply.status(404).send({ error: "run_not_found" });
    }
    return { run };
  });

  fastify.post("/api/profile/runs", async (request, reply) => {
    const parsed = CreateRunBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    if (!process.env.EXA_API_KEY?.trim()) {
      return reply.status(503).send({
        error: "exa_not_configured",
        message: "Set EXA_API_KEY to run landscape search.",
      });
    }

    const run = await runCompanyLandscape(parsed.data);
    const status = run.status === "failed" ? 502 : 201;
    return reply.status(status).send({ run: LandscapeRunSchema.parse(run) });
  });

  fastify.get("/api/profile/runs/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const run = getLandscapeRun(id);
    if (!run) {
      return reply.status(404).send({ error: "run_not_found" });
    }
    return { run: LandscapeRunSchema.parse(run) };
  });
}
