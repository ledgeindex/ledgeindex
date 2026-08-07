import { startLedgeIndexServer } from "@ledgeindex/server";
import type { FastifyInstance } from "fastify";

/** Same as ag-server: docs routes need request.user (local desktop user when auth off). */
async function registerDesktopAuth(app: FastifyInstance): Promise<void> {
  const firebaseAuthMiddleware = (
    await import("@ledgeindex/docs/runtime/middleware/firebase-auth.js")
  ).default;
  await app.register(firebaseAuthMiddleware);
}

function parseProfiles(): Array<"docs" | "profile"> {
  const raw = process.env.LEDGEINDEX_PROFILES ?? "docs,profile";
  return raw
    .split(",")
    .map((p) => p.trim())
    .map((p) => (p === "company" ? "profile" : p))
    .filter((p): p is "docs" | "profile" => p === "docs" || p === "profile");
}

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
