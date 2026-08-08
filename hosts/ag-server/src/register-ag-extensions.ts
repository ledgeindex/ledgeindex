import type { FastifyInstance } from "fastify";

/** Docs API routes expect request.user — same middleware as hosted ledgeindex-api. */
export async function registerAgServerExtensions(app: FastifyInstance): Promise<void> {
  const firebaseAuthMiddleware = (
    await import("@ledgeindex/docs/runtime/middleware/firebase-auth.js")
  ).default;
  await app.register(firebaseAuthMiddleware);
}