import { startLedgeIndexServer } from "@ledgeindex/server";
import "@ledgeindex/ag";
import { createAgMastraContribution } from "@ledgeindex/ag/mastra/ag-contribution";
import { registerAgServerExtensions } from "./register-ag-extensions.js";

function parseProfiles(): Array<"docs" | "profile" | "ag"> {
  const raw = process.env.LEDGEINDEX_PROFILES ?? "docs,profile,ag";
  return raw
    .split(",")
    .map((p) => p.trim())
    .map((p) => (p === "company" ? "profile" : p))
    .filter(Boolean) as Array<"docs" | "profile" | "ag">;
}

const port = Number.parseInt(process.env.PORT ?? "3010", 10);
const host = process.env.HOST ?? "127.0.0.1";

await startLedgeIndexServer({
  profiles: parseProfiles(),
  port,
  host,
  createAgMastraContribution,
  beforeProfiles: registerAgServerExtensions,
});

console.info(
  `[ag-server] listening on http://${host}:${port} profiles=${parseProfiles().join(",")}`,
);
