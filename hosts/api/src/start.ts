import "./load-env.js";
import type { FastifyInstance } from "fastify";
import { registerHostedInngest } from "@ledgeindex/docs";
import { logError, logInfo } from "@ledgeindex/docs/runtime/lib/logger.js";
import firebaseAuthMiddleware from "@ledgeindex/docs/runtime/middleware/firebase-auth.js";
import mcpOAuthFastifyMiddleware from "@ledgeindex/docs/runtime/middleware/mcp-oauth-fastify.js";
import requestLoggingMiddleware from "@ledgeindex/docs/runtime/middleware/request-logging.js";
import { mcpOAuthRoutes } from "@ledgeindex/docs/runtime/routes/mcp-oauth.js";
import { startLedgeIndexServer } from "@ledgeindex/server";

async function registerHostedExtensions(app: FastifyInstance): Promise<void> {
  await app.register(requestLoggingMiddleware);
  await app.register(firebaseAuthMiddleware);
  await app.register(mcpOAuthRoutes);
  await app.register(mcpOAuthFastifyMiddleware);
  await registerHostedInngest(app);
}

function parseProfiles(): Array<"docs" | "profile"> {
  const raw = process.env.LEDGEINDEX_PROFILES ?? "docs,profile";
  return raw
    .split(",")
    .map((part) => part.trim())
    .map((part) => (part === "company" ? "profile" : part))
    .filter((part): part is "docs" | "profile" => part === "docs" || part === "profile");
}

const start = async () => {
  try {
    const port = Number.parseInt(process.env.PORT ?? "3010", 10);
    const host = process.env.HOST ?? "0.0.0.0";
    const profiles = parseProfiles();

    await startLedgeIndexServer({
      profiles,
      port,
      host,
      beforeProfiles: registerHostedExtensions,
    });

    logInfo("LedgeIndex API started", "Server", {
      port,
      host,
      health: `http://localhost:${port}/health`,
      mcp: `http://localhost:${port}/mcp`,
      inngest: `http://localhost:${port}/api/inngest`,
      packages: `http://localhost:${port}/health/packages`,
    });
  } catch (error) {
    logError(error instanceof Error ? error : new Error(String(error)), "Server");
    process.exit(1);
  }
};

void start();
