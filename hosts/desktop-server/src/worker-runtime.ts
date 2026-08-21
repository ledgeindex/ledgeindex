/**
 * Bundle entry for the packaged desktop runtime.
 *
 * scripts/bundle-desktop-server.mjs compiles this into a single server.cjs and
 * ships only the packages that cannot be bundled (native addons, jsdom). Both
 * consumers load their whole surface from here:
 *   - the Electron worker thread (apps/desktop/src/main/ledgeindex-api-worker.ts)
 *   - the standalone launcher used for pack smoke tests and debugging
 */
import type { FastifyInstance } from "fastify";
import {
  createLedgeIndexServer,
  startLedgeIndexServer,
} from "@ledgeindex/server";
import firebaseAuthMiddleware from "@ledgeindex/docs/runtime/middleware/firebase-auth.js";
import { registerOpenMcpDiscoveryRoutes } from "@ledgeindex/docs/runtime/routes/mcp-open-discovery.js";
import { watchParentProcess } from "./parent-watchdog.js";

export {
  createLedgeIndexServer,
  startLedgeIndexServer,
  firebaseAuthMiddleware,
  registerOpenMcpDiscoveryRoutes,
};

export function parseProfiles(
  raw = process.env.LEDGEINDEX_PROFILES ?? "docs,profile",
): Array<"docs" | "profile"> {
  return raw
    .split(",")
    .map((p) => p.trim())
    .map((p) => (p === "company" ? "profile" : p))
    .filter((p): p is "docs" | "profile" => p === "docs" || p === "profile");
}

/** Docs routes need request.user (local desktop user when auth is off). */
export async function registerDesktopAuth(app: FastifyInstance): Promise<void> {
  await app.register(firebaseAuthMiddleware);
  await registerOpenMcpDiscoveryRoutes(app);
}

/** Standalone entry: what dist/start.js used to do, minus the module resolution. */
export async function startStandalone(): Promise<void> {
  watchParentProcess();

  const port = Number.parseInt(process.env.PORT ?? "3015", 10);
  const host = process.env.HOST ?? "127.0.0.1";
  const profiles = parseProfiles();

  await startLedgeIndexServer({
    profiles,
    port,
    host,
    beforeProfiles: registerDesktopAuth,
  });

  console.info(
    `[desktop-server] listening on http://${host}:${port} profiles=${profiles.join(",")}`,
  );
}
