import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin, requireUser } from "../lib/resource-access.js";
import {
  listUserAccess,
  requestUserAccess,
  setUserAccessStatus,
} from "../services/user-access.js";

const requestAccessSchema = z.object({
  note: z.string().max(500).optional(),
});

const reviewAccessSchema = z.object({
  status: z.enum(["approved", "denied"]),
});

export async function accessRoutes(fastify: FastifyInstance) {
  /** Reachable while pending — see isAccessGateExempt in require-approved-access. */
  fastify.post("/api/access-request", async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return;

    const body = requestAccessSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.status(400).send({ error: body.error.flatten() });
    }

    const accessStatus = await requestUserAccess(
      userId,
      body.data.note?.trim() || null,
    );
    return { accessStatus };
  });

  fastify.get("/api/admin/users", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    return { users: await listUserAccess() };
  });

  fastify.post("/api/admin/users/:uid/access", async (request, reply) => {
    const reviewerId = await requireUser(request, reply);
    if (!reviewerId) return;
    if (!(await requireAdmin(request, reply))) return;

    const params = z
      .object({ uid: z.string().min(1) })
      .safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Missing user id" });
    }

    const body = reviewAccessSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.status(400).send({ error: body.error.flatten() });
    }

    await setUserAccessStatus(params.data.uid, body.data.status, reviewerId);
    return { uid: params.data.uid, accessStatus: body.data.status };
  });
}
