#!/usr/bin/env node
/**
 * LedgeIndex desktop release — no GitHub UI needed.
 *
 * Usage (from ledgeindex/):
 *   npm run release:desktop -- 0.1.0 --release
 *
 * Loads PAT from env or monorepo-root .env key PAT_LEDDGEINDEX / PAT_LEDGEINDEX
 * (classic PAT scopes: repo + workflow).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ledgeRoot = resolve(__dirname, "..");
const monoRoot = resolve(ledgeRoot, "..");
const pkgPath = resolve(ledgeRoot, "apps/desktop/package.json");
const PUBLIC_REPO = "ledgeindex/ledgeindex";

const TOKEN_FILES = [
  "PAT_LEDGEINDEX",
  "PAT_LEDDGEINDEX",
  "LEDGEINDEX_PUBLIC_PUSH_TOKEN",
  ".pat-ledgeindex",
  ".env",
];

const TOKEN_ENV_KEYS = [
  "LEDGEINDEX_PUBLIC_PUSH_TOKEN",
  "GH_TOKEN",
  "PAT_LEDGEINDEX",
  "PAT_LEDDGEINDEX",
];

const args = process.argv.slice(2).filter((a) => a !== "--");
const doRelease =
  args.includes("--release") || args.includes("--tag") || args.includes("-r");
const versionArg = args.find((a) => !a.startsWith("-"));

function readPkg() {
  return JSON.parse(readFileSync(pkgPath, "utf8"));
}

function writeVersion(version) {
  if (!/^\d+\.\d+\.\d+([.-][\w.-]+)?$/.test(version)) {
    console.error(`Invalid version: ${version} (expected e.g. 0.1.0)`);
    process.exit(1);
  }
  const pkg = readPkg();
  const prev = pkg.version;
  pkg.version = version;
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`Version: ${prev} → ${version}`);
}

function loadTokenFromFile(filePath) {
  if (!existsSync(filePath)) return null;
  const raw = readFileSync(filePath, "utf8");
  if (!raw.trim()) return null;

  for (const key of TOKEN_ENV_KEYS) {
    const re = new RegExp(`^\\s*${key}\\s*=\\s*(.+)\\s*$`, "im");
    const m = raw.match(re);
    if (m) {
      const value = m[1].trim().replace(/^["']|["']$/g, "");
      if (value) return value;
    }
  }

  const base = filePath.split(/[/\\]/).pop() || "";
  if (base === ".env") return null;
  const line = raw
    .split(/\r?\n/)
    .find((l) => l.trim() && !l.trim().startsWith("#"));
  if (!line) return null;
  return line.trim().replace(/^["']|["']$/g, "") || null;
}

function resolveToken() {
  for (const key of TOKEN_ENV_KEYS) {
    const v = process.env[key];
    if (v?.trim()) return { token: v.trim(), source: `env:${key}` };
  }

  for (const root of [monoRoot, ledgeRoot]) {
    for (const name of TOKEN_FILES) {
      const filePath = resolve(root, name);
      const token = loadTokenFromFile(filePath);
      if (token) return { token, source: filePath };
    }
  }
  return { token: "", source: null };
}

async function createPublicTag(version, token) {
  const tag = `desktop-v${version}`;
  const api = "https://api.github.com";
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "ledgeindex-release-desktop",
  };

  const refRes = await fetch(`${api}/repos/${PUBLIC_REPO}/git/ref/heads/main`, {
    headers,
  });
  if (!refRes.ok) {
    const body = await refRes.text();
    console.error(`Could not read main on ${PUBLIC_REPO}:`, refRes.status, body);
    process.exit(1);
  }
  const { object } = await refRes.json();
  const sha = object?.sha;
  if (!sha) {
    console.error("No SHA for main");
    process.exit(1);
  }

  const tagRes = await fetch(`${api}/repos/${PUBLIC_REPO}/git/refs`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      ref: `refs/tags/${tag}`,
      sha,
    }),
  });

  if (tagRes.status === 422) {
    console.error(
      `Tag ${tag} already exists. Bump the version (e.g. 0.1.1) and retry.`,
    );
    process.exit(1);
  }
  if (!tagRes.ok) {
    const body = await tagRes.text();
    console.error(`Failed to create tag ${tag}:`, tagRes.status, body);
    process.exit(1);
  }

  console.log(`Tagged ${tag} on ${PUBLIC_REPO} @ ${sha.slice(0, 7)}`);
  console.log(`CI:      https://github.com/${PUBLIC_REPO}/actions`);
  console.log(`Release: https://github.com/${PUBLIC_REPO}/releases`);
}

const pkg = readPkg();
const version = versionArg || pkg.version;

if (!versionArg && !doRelease) {
  console.log(`Current desktop version: ${pkg.version}`);
  console.log(`
Release with:
  npm run release:desktop -- ${pkg.version} --release
`);
  process.exit(0);
}

if (versionArg) {
  writeVersion(versionArg);
}

if (!doRelease) {
  console.log(`Version set to ${version}. Add --release to create the public tag.`);
  process.exit(0);
}

const { token, source } = resolveToken();
if (!token) {
  console.error(`No PAT found in env or .env (PAT_LEDDGEINDEX / PAT_LEDGEINDEX).`);
  process.exit(1);
}

console.log(`Using token from: ${source}`);
console.log(`Releasing desktop ${version} → tag desktop-v${version}`);
await createPublicTag(version, token);
console.log("\nDone. Watch Desktop release CI for the Windows installer.");
