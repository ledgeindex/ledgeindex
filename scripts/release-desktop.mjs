#!/usr/bin/env node
/**
 * LedgeIndex desktop release — no GitHub UI needed.
 *
 * Usage (from ledgeindex/):
 *   npm run release:desktop -- --bump          # auto patch: 0.1.0 → 0.1.1
 *   npm run release:desktop -- --bump minor    # 0.1.0 → 0.2.0
 *   npm run release:desktop -- --release       # tag current version on public
 *   npm run release:desktop -- 0.2.0 --release # set exact version + tag
 *
 * Bumps refresh ledgeindex/package-lock.json (@ledgeindex/desktop workspace entry).
 * Loads PAT from env or monorepo-root .env key PAT_LEDDGEINDEX / PAT_LEDGEINDEX
 * (classic PAT scopes: repo + workflow).
 */
import { execSync } from "node:child_process";
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
const bumpIdx = args.findIndex((a) => a === "--bump" || a === "-b");
const wantsBump = bumpIdx !== -1;
const bumpLevelRaw = wantsBump ? args[bumpIdx + 1] : null;
const bumpLevel =
  bumpLevelRaw && !bumpLevelRaw.startsWith("-") ? bumpLevelRaw : "patch";
const versionArg = args.find(
  (a, i) =>
    !a.startsWith("-") &&
    !(wantsBump && i === bumpIdx + 1 && bumpLevelRaw === a),
);

function readPkg() {
  return JSON.parse(readFileSync(pkgPath, "utf8"));
}

function bumpSemver(version, level) {
  const m = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) {
    console.error(`Cannot bump version: ${version}`);
    process.exit(1);
  }
  let major = Number(m[1]);
  let minor = Number(m[2]);
  let patch = Number(m[3]);
  if (level === "major") {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (level === "minor") {
    minor += 1;
    patch = 0;
  } else if (level === "patch") {
    patch += 1;
  } else {
    console.error(`Unknown bump level: ${level} (use patch|minor|major)`);
    process.exit(1);
  }
  return `${major}.${minor}.${patch}`;
}

function writeVersion(version) {
  if (!/^\d+\.\d+\.\d+([.-][\w.-]+)?$/.test(version)) {
    console.error(`Invalid version: ${version} (expected e.g. 0.1.0)`);
    process.exit(1);
  }
  const pkg = readPkg();
  const prev = pkg.version;
  if (prev === version) {
    console.log(`Version already ${version}`);
    return false;
  }
  pkg.version = version;
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`Version: ${prev} → ${version}`);
  return true;
}

/** Keep workspace lockfile in sync with apps/desktop/package.json (same as release:packages). */
function refreshLockfile() {
  console.log("\n→ refreshing ledgeindex/package-lock.json");
  execSync(
    "npm install --package-lock-only --no-audit --no-fund -w @ledgeindex/desktop",
    { cwd: ledgeRoot, stdio: "inherit" },
  );
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

async function ghFetch(url, token, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "ledgeindex-release-desktop",
        ...(init.headers || {}),
      },
    });
  } catch (err) {
    if (err?.name === "AbortError") {
      console.error(`GitHub request timed out after 20s:\n  ${url}`);
      process.exit(1);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPublicDesktopVersion(token) {
  const url = `https://api.github.com/repos/${PUBLIC_REPO}/contents/apps/desktop/package.json?ref=main`;
  console.log("Checking public desktop version on main…");
  const res = await ghFetch(url, token);
  if (!res.ok) {
    const body = await res.text();
    console.error(
      `Could not read public desktop package.json:`,
      res.status,
      body,
    );
    process.exit(1);
  }
  const data = await res.json();
  const raw = Buffer.from(data.content, "base64").toString("utf8");
  return JSON.parse(raw).version;
}

async function createPublicTag(version, token) {
  const tag = `desktop-v${version}`;
  const api = "https://api.github.com";

  const publicVersion = await fetchPublicDesktopVersion(token);
  console.log(`Public main desktop version: ${publicVersion}`);
  if (publicVersion !== version) {
    console.error(`
Public main still has desktop version ${publicVersion} (wanted ${version}).

Do this first:
  1. Bump locally (if not done):  npm run release:desktop -- ${version}
  2. Commit + push to private main (triggers Sync ledgeindex → public)
  3. Wait until that sync workflow is green
  4. Re-run:  npm run release:desktop -- ${version} --release
`);
    process.exit(1);
  }

  console.log("Reading public main SHA…");
  const refRes = await ghFetch(`${api}/repos/${PUBLIC_REPO}/git/ref/heads/main`, token);
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

  const existingTagRes = await ghFetch(
    `${api}/repos/${PUBLIC_REPO}/git/ref/tags/${tag}`,
    token,
  );
  if (existingTagRes.ok) {
    const releaseRes = await ghFetch(
      `${api}/repos/${PUBLIC_REPO}/releases/tags/${tag}`,
      token,
    );
    let assetCount = 0;
    if (releaseRes.ok) {
      const release = await releaseRes.json();
      assetCount = Array.isArray(release.assets) ? release.assets.length : 0;
    }

    if (assetCount > 0) {
      console.error(
        `Tag ${tag} already has a release with ${assetCount} asset(s). Bump the version and retry.`,
      );
      process.exit(1);
    }

    console.log(
      `Tag ${tag} exists but has no installer assets (likely a failed/invalid workflow). Recreating tag to re-trigger CI…`,
    );
    const delRes = await ghFetch(
      `${api}/repos/${PUBLIC_REPO}/git/refs/tags/${tag}`,
      token,
      { method: "DELETE" },
    );
    if (!delRes.ok && delRes.status !== 404) {
      const body = await delRes.text();
      console.error(`Could not delete orphan tag ${tag}:`, delRes.status, body);
      process.exit(1);
    }
  }

  console.log(`Creating tag ${tag} @ ${sha.slice(0, 7)}…`);
  const tagRes = await ghFetch(`${api}/repos/${PUBLIC_REPO}/git/refs`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ref: `refs/tags/${tag}`,
      sha,
    }),
  });

  if (tagRes.status === 422) {
    console.error(
      `Tag ${tag} already exists. Bump the version (e.g. 0.1.2) and retry.`,
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
let version = pkg.version;

if (!versionArg && !wantsBump && !doRelease) {
  console.log(`Current desktop version: ${pkg.version}`);
  console.log(`
Flow:
  1. npm run release:desktop -- 0.1.1          # set version (+ lockfile)
  2. Commit package.json + package-lock.json + push private main → wait for Sync
  3. npm run release:desktop -- 0.1.1 --release  # tag that version on public

Or use VS Code tasks (prompts for version):
  - LedgeIndex Desktop: bump version
  - LedgeIndex Desktop: tag public release
`);
  process.exit(0);
}

let versionChanged = false;

if (versionArg) {
  version = versionArg;
  versionChanged = writeVersion(version);
} else if (wantsBump) {
  version = bumpSemver(pkg.version, bumpLevel);
  versionChanged = writeVersion(version);
}

if (versionChanged) {
  refreshLockfile();
}

if (!doRelease) {
  console.log(
    `Version set to ${version}. Commit package.json + package-lock.json, push, wait for Sync, then run with --release.`,
  );
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
console.log("\nDone. Watch Desktop release CI for Windows + macOS installers.");
