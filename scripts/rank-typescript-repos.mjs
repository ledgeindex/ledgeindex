#!/usr/bin/env node
/**
 * Rank top TypeScript GitHub repos by stars.
 *
 * Usage (from ledgeindex/ or repo root):
 *   node scripts/rank-typescript-repos.mjs
 *   node scripts/rank-typescript-repos.mjs --limit 100
 *
 * Token: LEDGEINDEX_REPO_RANKER (or GITHUB_TOKEN / GH_TOKEN)
 * loaded from env or monorepo-root / ledgeindex .env
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ledgeRoot = resolve(__dirname, "..");
const monoRoot = resolve(ledgeRoot, "..");

const TOKEN_KEYS = [
  "LEDGEINDEX_REPO_RANKER",
  "GITHUB_TOKEN",
  "GH_TOKEN",
];

const args = process.argv.slice(2);
const limitIdx = args.findIndex((a) => a === "--limit" || a === "-n");
const limit = Math.min(
  1000,
  Math.max(
    1,
    Number(
      limitIdx !== -1 && args[limitIdx + 1]
        ? args[limitIdx + 1]
        : 100,
    ) || 100,
  ),
);
const outIdx = args.findIndex((a) => a === "--out" || a === "-o");
const outPath =
  outIdx !== -1 && args[outIdx + 1]
    ? resolve(process.cwd(), args[outIdx + 1])
    : resolve(ledgeRoot, "top-typescript-repos.json");

function loadTokenFromFile(filePath) {
  if (!existsSync(filePath)) return null;
  const raw = readFileSync(filePath, "utf8");
  for (const key of TOKEN_KEYS) {
    const m = raw.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+)\\s*$`, "im"));
    if (!m) continue;
    const value = m[1].trim().replace(/^["']|["']$/g, "");
    if (value) return { token: value, source: `${filePath} (${key})` };
  }
  return null;
}

function resolveToken() {
  for (const key of TOKEN_KEYS) {
    const v = process.env[key]?.trim();
    if (v) return { token: v, source: `env:${key}` };
  }
  for (const root of [monoRoot, ledgeRoot]) {
    const hit = loadTokenFromFile(resolve(root, ".env"));
    if (hit) return hit;
  }
  return { token: "", source: null };
}

async function searchPage(token, page, perPage) {
  const q = encodeURIComponent("language:TypeScript");
  const url = `https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=${perPage}&page=${page}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "ledgeindex-repo-ranker",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub search failed (${res.status}): ${body}`);
  }
  return res.json();
}

function mapRepo(repo, rank) {
  return {
    rank,
    name: repo.full_name,
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    url: repo.html_url,
    description: repo.description,
    language: repo.language,
    topics: repo.topics ?? [],
    archived: Boolean(repo.archived),
    fork: Boolean(repo.fork),
    updatedAt: repo.updated_at,
  };
}

const { token, source } = resolveToken();
if (!token) {
  console.error(
    "No token found. Set LEDGEINDEX_REPO_RANKER in the monorepo-root .env",
  );
  process.exit(1);
}

console.log(`Using token from: ${source}`);
console.log(`Fetching top ${limit} TypeScript repos by stars…`);

const perPage = 100;
const pages = Math.ceil(limit / perPage);
const rows = [];

for (let page = 1; page <= pages; page += 1) {
  const data = await searchPage(token, page, perPage);
  const items = Array.isArray(data.items) ? data.items : [];
  if (items.length === 0) break;
  for (const repo of items) {
    if (rows.length >= limit) break;
    rows.push(mapRepo(repo, rows.length + 1));
  }
  console.log(`  page ${page}: +${items.length} (total ${rows.length})`);
  if (items.length < perPage) break;
}

writeFileSync(outPath, `${JSON.stringify(rows, null, 2)}\n`);

console.log("");
console.log("Rank  Stars    Repo");
console.log("----  -------  ----");
for (const row of rows.slice(0, Math.min(25, rows.length))) {
  console.log(
    `${String(row.rank).padStart(4)}  ${String(row.stars).padStart(7)}  ${row.name}`,
  );
}
if (rows.length > 25) {
  console.log(`… and ${rows.length - 25} more`);
}
console.log("");
console.log(`Wrote ${rows.length} repos → ${outPath}`);
