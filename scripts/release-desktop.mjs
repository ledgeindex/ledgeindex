#!/usr/bin/env node
/**
 * Prepare + optionally publish a LedgeIndex desktop release.
 *
 * Usage:
 *   node scripts/release-desktop.mjs                 # show status / next steps
 *   node scripts/release-desktop.mjs 0.1.0           # set version in package.json
 *   node scripts/release-desktop.mjs 0.1.0 --tag     # set version + create public tag
 *                                                    # (triggers Desktop release CI)
 *
 * --tag needs LEDGEINDEX_PUBLIC_PUSH_TOKEN or GH_TOKEN with repo+workflow
 * on ledgeindex/ledgeindex (same PAT as the sync Action).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const pkgPath = resolve(root, "apps/desktop/package.json");
const PUBLIC_REPO = "ledgeindex/ledgeindex";

const args = process.argv.slice(2).filter((a) => a !== "--");
const doTag = args.includes("--tag");
const versionArg = args.find((a) => !a.startsWith("--"));

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
  console.log(`Version: ${prev} → ${version} (${pkgPath})`);
}

async function createPublicTag(version) {
  const token =
    process.env.LEDGEINDEX_PUBLIC_PUSH_TOKEN || process.env.GH_TOKEN || "";
  if (!token) {
    console.error(
      "Missing LEDGEINDEX_PUBLIC_PUSH_TOKEN or GH_TOKEN for --tag.",
    );
    process.exit(1);
  }

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
      `Tag ${tag} already exists. Bump the version or delete the tag first.`,
    );
    process.exit(1);
  }
  if (!tagRes.ok) {
    const body = await tagRes.text();
    console.error(`Failed to create tag ${tag}:`, tagRes.status, body);
    process.exit(1);
  }

  console.log(`Created tag ${tag} on ${PUBLIC_REPO} @ ${sha.slice(0, 7)}`);
  console.log(
    `CI: https://github.com/${PUBLIC_REPO}/actions/workflows/desktop-release.yml`,
  );
  console.log(`Releases: https://github.com/${PUBLIC_REPO}/releases`);
}

const pkg = readPkg();
const version = versionArg || pkg.version;

if (versionArg) {
  writeVersion(versionArg);
}

console.log(`
Desktop release
---------------
Version:  ${version}
Tag:      desktop-v${version}
Public:   https://github.com/${PUBLIC_REPO}

Steps:
  1. Commit apps/desktop/package.json (if you bumped the version)
  2. Push to private main → sync Action updates public repo
  3. Wait until sync is green
  4. Create the tag:
       node scripts/release-desktop.mjs ${version} --tag
     or manually on public:
       git tag desktop-v${version} && git push origin desktop-v${version}

  Tag push starts the Windows (+ Mac) build and GitHub Release.
`);

if (doTag) {
  await createPublicTag(version);
}
