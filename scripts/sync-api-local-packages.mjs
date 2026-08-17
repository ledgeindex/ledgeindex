/**
 * Build local @ledgeindex packages for chat/API testing.
 * This monorepo already symlinks node_modules/@ledgeindex/* → ledgeindex/packages/*.
 * After this, restart dev:ledgeindex-api.
 *
 *   node ledgeindex/scripts/sync-api-local-packages.mjs
 *   npm run sync:ledgeindex-api-local   (from repo root)
 */
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const ledgeRoot = resolve(scriptsDir, "..");
const monoRoot = resolve(ledgeRoot, "..");

const linkedCore = resolve(monoRoot, "node_modules/@ledgeindex/core");
const isWorkspaceLink =
  existsSync(linkedCore) &&
  !linkedCore.includes("ledgeindex-api/node_modules");

console.log("Building @ledgeindex/core, docs, server…");
execSync(
  "npm run build -w @ledgeindex/core -w @ledgeindex/docs -w @ledgeindex/server",
  { cwd: ledgeRoot, stdio: "inherit" },
);

if (isWorkspaceLink) {
  console.log("\nWorkspace symlinks detected — API uses local packages after build.");
} else {
  console.log(
    "\nWarning: run npm install from repo root if API still uses published 0.1.13.",
  );
}

console.log("Restart chat API: npm run dev:ledgeindex-api");
