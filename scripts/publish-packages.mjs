#!/usr/bin/env node
/**
 * Publish @ledgeindex/* to npm (ledgeindex org).
 *
 * Auth (pick one):
 *   - Local: `npm login` (token in ~/.npmrc)
 *   - CI / automation: export NPM_TOKEN
 *
 *   node ledgeindex/scripts/publish-packages.mjs --dry-run
 *   node ledgeindex/scripts/publish-packages.mjs --package @ledgeindex/core
 */
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGES = [
  "@ledgeindex/core",
  "@ledgeindex/repo",
  "@ledgeindex/profile",
  "@ledgeindex/docs",
  "@ledgeindex/client",
  "@ledgeindex/ag",
  "@ledgeindex/server",
  "@ledgeindex/model",
];

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  if (i === -1 || i === process.argv.length - 1) return null;
  return process.argv[i + 1];
}

const dryRun = process.argv.includes("--dry-run");
const only = argValue("--package");
/** Monorepo root that owns the workspaces (ledgeindex/). */
const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

const targets = only ? [only] : PACKAGES;

for (const name of targets) {
  if (!PACKAGES.includes(name)) {
    console.error(`Unknown package: ${name}\nAllowed: ${PACKAGES.join(", ")}`);
    process.exit(1);
  }
}

const token = process.env.NPM_TOKEN?.trim();
let userconfigDir = null;
let userconfigPath = null;
const env = { ...process.env };

if (token) {
  console.log("Using NPM_TOKEN from environment for registry auth.");
  userconfigDir = mkdtempSync(path.join(tmpdir(), "ledgeindex-npm-"));
  userconfigPath = path.join(userconfigDir, ".npmrc");
  writeFileSync(
    userconfigPath,
    `//registry.npmjs.org/:_authToken=${token}\naccess=public\n`,
    { mode: 0o600 },
  );
  env.NPM_CONFIG_USERCONFIG = userconfigPath;
} else {
  try {
    const who = execSync("npm whoami", { cwd: root, encoding: "utf8" }).trim();
    console.log(`Using npm login as: ${who}`);
  } catch {
    console.warn(
      "Not logged in and NPM_TOKEN unset. Run `npm login` or export NPM_TOKEN before a real publish.",
    );
  }
}

try {
  for (const name of targets) {
    const flags = dryRun ? "--dry-run" : "";
    console.log(`\n→ ${dryRun ? "dry-run " : ""}publish ${name}`);
    execSync(`npm publish -w ${name} ${flags}`.trim(), {
      cwd: root,
      stdio: "inherit",
      env,
    });
  }
  console.log("\nDone.");
} finally {
  if (userconfigDir) {
    try {
      rmSync(userconfigDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}
