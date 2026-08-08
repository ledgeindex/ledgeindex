import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getStore } from "../db/index.js";
import {
  getProjectForUser,
  listProjectsForUser,
  requireUser,
} from "../lib/resource-access.js";

const createProjectSchema = z.object({
  name: z.string().min(1).max(200),
});

export async function projectRoutes(fastify: FastifyInstance) {
  fastify.get("/api/projects", async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return;

    const projects = await listProjectsForUser(userId);
    return { projects };
  });

  fastify.post("/api/projects", async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return;

    const body = createProjectSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: body.error.flatten() });
    }

    const project = await getStore().createProject(body.data.name, userId);
    return reply.status(201).send({ project });
  });

  fastify.get("/api/projects/:id", async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return;

    const { id } = request.params as { id: string };
    const project = await getProjectForUser(id, userId);
    if (!project) {
      return reply.status(404).send({ error: "Project not found" });
    }
    return { project };
  });
}
