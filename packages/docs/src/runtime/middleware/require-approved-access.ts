import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { isApiAuthRequired } from "../lib/firebase-admin.js";
import { logInfo } from "../lib/logger.js";
import { getUserAccessStatus } from "../services/user-access.js";

/**
 * Endpoints an unapproved account may still reach: it has to be able to read its own
 * status and ask to be let in, otherwise the gate is a dead end.
 */
function isAccessGateExempt(url: string): boolean {
  const path = url.split("?")[0] ?? url;
  return (
    path === "/api/auth/me" ||
    path === "/api/access-request" ||
    path === "/health" ||
    path.startsWith("/health/")
  );
}

/**
 * Early-access gate: while the product is invite-only, a signed-in non-admin account
 * gets 403 until an admin approves it. Only active where auth is required, so local
 * desktop installs (which run their own server) are untouched.
 */
const requireApprovedAccessPlugin: FastifyPluginAsync = async (fastify) => {
  if (!isApiAuthRequired()) return;

  logInfo("Early-access gate enabled — unapproved accounts get 403", "Auth");

  fastify.addHook("preHandler", async (request, reply) => {
    if (request.method === "OPTIONS") return;
    if (isAccessGateExempt(request.url)) return;

    const uid = request.user?.uid?.trim();
    if (!uid) return;

    const status = await getUserAccessStatus(uid);
    if (status === "approved") return;

    return reply.code(403).send({
      error:
        status === "denied"
          ? "Access request was declined"
          : "Access is pending approval",
      accessStatus: status,
    });
  });
};

export default fp(requireApprovedAccessPlugin, {
  name: "require-approved-access-middleware",
});
