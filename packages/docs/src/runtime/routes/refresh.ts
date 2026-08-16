import type { FastifyInstance } from "fastify";
import {
  applySourceRefresh,
  cancelSourceRefresh,
  dismissSourceRefresh,
  getSourceRefreshStatus,
  startSourceRefreshCheck,
} from "../services/source-refresh.js";
import { logError } from "../lib/logger.js";
import { getRequestUserRole, getSourceForUser, getSourceForWrite, requireUser } from "../lib/resource-access.js";
import type { RefreshMode } from "../refresh/active-refresh-runs.js";

export async function refreshRoutes(fastify: FastifyInstance) {
  fastify.post("/api/sources/:id/refresh/start", async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return;

    const role = await getRequestUserRole(request);
    const { id } = request.params as { id: string };
    const source = await getSourceForWrite(id, userId, role);
    if (!source) {
      return reply.status(404).send({ error: "Source not found" });
    }

    try {
      const body = (request.body ?? {}) as { mode?: RefreshMode };
      const mode: RefreshMode =
        body.mode === "selected"
          ? "selected"
          : body.mode === "probe"
            ? "probe"
            : "discover";
      const snapshot = await startSourceRefreshCheck(id, { mode });
      return { snapshot };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to start refresh";
      logError(error instanceof Error ? error : message, "RefreshRoutes", {
        sourceId: id,
      });
      return reply.status(500).send({ error: message });
    }
  });

  fastify.get("/api/sources/:id/refresh/status", async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return;

    const { id } = request.params as { id: string };
    const source = await getSourceForUser(id, userId);
    if (!source) {
      return reply.status(404).send({ error: "Source not found" });
    }

    const snapshot = getSourceRefreshStatus(id);
    return { snapshot };
  });

  fastify.post("/api/sources/:id/refresh/cancel", async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return;

    const role = await getRequestUserRole(request);
    const { id } = request.params as { id: string };
    const source = await getSourceForWrite(id, userId, role);
    if (!source) {
      return reply.status(404).send({ error: "Source not found" });
    }

    cancelSourceRefresh(id);
    return { cancelled: true };
  });

  fastify.post("/api/sources/:id/refresh/apply", async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return;

    const role = await getRequestUserRole(request);
    const { id } = request.params as { id: string };
    const source = await getSourceForWrite(id, userId, role);
    if (!source) {
      return reply.status(404).send({ error: "Source not found" });
    }

    try {
      const snapshot = await applySourceRefresh(id);
      return { snapshot };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to apply refresh";
      logError(error instanceof Error ? error : message, "RefreshRoutes", {
        sourceId: id,
      });
      return reply.status(400).send({ error: message });
    }
  });

  fastify.post("/api/sources/:id/refresh/dismiss", async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return;

    const role = await getRequestUserRole(request);
    const { id } = request.params as { id: string };
    const source = await getSourceForWrite(id, userId, role);
    if (!source) {
      return reply.status(404).send({ error: "Source not found" });
    }

    dismissSourceRefresh(id);
    return { dismissed: true };
  });
}
