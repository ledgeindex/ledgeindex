import type { FastifyInstance } from "fastify";

export async function registerAgProfileRoutes(fastify: FastifyInstance): Promise<void> {
  const { registerAgWorkspaceSearchRoutes } = await import(
    "./workspace-search-route.js"
  );
  await registerAgWorkspaceSearchRoutes(fastify);

  fastify.get("/api/ag/health", async () => ({
    ok: true,
    profile: "ag",
    version: "0.1.0",
  }));
}
