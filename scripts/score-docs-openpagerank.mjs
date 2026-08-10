#!/usr/bin/env node
/**
 * Score docs URLs with Open PageRank (domain of `docs`, not homepage).
 *
 * Annotates each row with openPageRank / docsDomain. By default keeps the
 * existing list order (npm downloads). Pass --sort opr to reorder by PageRank.
 *
 * Pipeline:
 *   1. node scripts/build-typescript-docs-list.mjs --limit 500
 *   2. node scripts/categorize-docs-with-llm.mjs --input ./top-typescript-docs.json
 *   3. node scripts/score-docs-openpagerank.mjs --input ./top-typescript-docs.json
 *
 * Env (monorepo-root or ledgeindex .env):
 *   OPENPAGERANK_API_KEY  (or OPR_API_KEY / LEDGEINDEX_OPENPAGERANK_KEY)
 *
 * Supports:
 *   - Keywords Everywhere OPR: POST openpagerank.keywordseverywhere.com/v1/domains/bulk
 *     (Authorization: Bearer <key>)
 *   - Legacy DomCop Open PageRank: GET openpagerank.com/api/v1.0/getPageRank
 *     (API-OPR: <key>)  — use --provider legacy
 *
 * Usage:
 *   node scripts/score-docs-openpagerank.mjs
 *   node scripts/score-docs-openpagerank.mjs --provider ke
 *   node scripts/score-docs-openpagerank.mjs --provider legacy
 *   node scripts/score-docs-openpagerank.mjs --sort opr
 *   node scripts/score-docs-openpagerank.mjs --sort opr --top 100
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ledgeRoot = resolve(__dirname, "..");
const monoRoot = resolve(ledgeRoot, "..");

const TOKEN_KEYS = [
  "OPENPAGERANK_API_KEY",
  "OPR_API_KEY",
  "LEDGEINDEX_OPENPAGERANK_KEY",
];

const args = process.argv.slice(2);
function argValue(flag, fallback = null) {
  const i = args.findIndex((a) => a === flag);
  if (i === -1) return fallback;
  const next = args[i + 1];
  if (!next || next.startsWith("-")) return true;
  return next;
}

const provider = String(argValue("--provider", "ke")); // ke | legacy
const sortMode = String(argValue("--sort", "keep")); // keep | opr | downloads
const inputPath = resolve(
  process.cwd(),
  String(argValue("--input", resolve(ledgeRoot, "top-typescript-docs.json"))),
);
const outPath = resolve(
  process.cwd(),
  String(argValue("--out", inputPath)),
);
const limitRaw = argValue("--limit", null);
const topRaw = argValue("--top", null);
const limit = limitRaw == null ? null : Math.max(1, Number(limitRaw) || 1);
const topN = topRaw == null ? null : Math.max(1, Number(topRaw) || 1);

if (!["keep", "opr", "downloads"].includes(sortMode)) {
  console.error(`Invalid --sort ${sortMode} (use keep | opr | downloads)`);
  process.exit(1);
}

function loadKeyFromFile(filePath) {
  if (!existsSync(filePath)) return null;
  const raw = readFileSync(filePath, "utf8");
  for (const key of TOKEN_KEYS) {
    const m = raw.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+)\\s*$`, "im"));
    if (!m) continue;
    const value = m[1].trim().replace(/^["']|["']$/g, "");
    if (value) return { key: value, source: `${filePath} (${key})` };
  }
  return null;
}

function resolveApiKey() {
  for (const key of TOKEN_KEYS) {
    const v = process.env[key]?.trim();
    if (v) return { key: v, source: `env:${key}` };
  }
  for (const root of [monoRoot, ledgeRoot]) {
    const hit = loadKeyFromFile(resolve(root, ".env"));
    if (hit) return hit;
  }
  return { key: "", source: null };
}

function domainFromUrl(input) {
  if (!input) return null;
  try {
    const raw = String(input).includes("://") ? input : `https://${input}`;
    const host = new URL(raw).hostname.replace(/^www\./, "");
    if (!host) return null;
    // Skip github.com repo pages — not real docs sites (keep *.github.io).
    if (host === "github.com" || host === "githubusercontent.com") return null;
    if (host.endsWith(".githubusercontent.com")) return null;
    return host;
  } catch {
    return null;
  }
}

/** Prefer docs URL domain; only fall back to homepage if docs is missing/github. */
function docsDomainForEntry(entry) {
  return (
    domainFromUrl(entry.docs) ||
    domainFromUrl(entry.homepage) ||
    domainFromUrl(entry.url) ||
    null
  );
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchKeBulk(apiKey, domains) {
  const res = await fetch(
    "https://openpagerank.keywordseverywhere.com/v1/domains/bulk",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "ledgeindex-opr-scorer",
      },
      body: JSON.stringify({
        domains,
        include_history: false,
      }),
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`KE OpenPageRank failed (${res.status}): ${body.slice(0, 400)}`);
  }
  const data = await res.json();
  const map = new Map();
  for (const row of data.results || []) {
    if (!row?.domain) continue;
    map.set(row.domain, {
      domain: row.domain,
      openPageRank: row.open_page_rank ?? null,
      globalRank: row.rank ?? null,
      referringDomains: row.referring_domains ?? null,
    });
  }
  return map;
}

async function fetchLegacyBulk(apiKey, domains) {
  const params = new URLSearchParams();
  domains.forEach((domain, i) => {
    params.append(`domains[${i}]`, domain);
  });
  const res = await fetch(
    `https://openpagerank.com/api/v1.0/getPageRank?${params.toString()}`,
    {
      headers: {
        "API-OPR": apiKey,
        Accept: "application/json",
        "User-Agent": "ledgeindex-opr-scorer",
      },
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Legacy OpenPageRank failed (${res.status}): ${body.slice(0, 400)}`,
    );
  }
  const data = await res.json();
  const map = new Map();
  for (const row of data.response || []) {
    const domain = row.domain || row.target;
    if (!domain) continue;
    map.set(String(domain).replace(/^www\./, ""), {
      domain,
      openPageRank:
        row.page_rank_decimal != null
          ? Number(row.page_rank_decimal)
          : row.page_rank_integer != null
            ? Number(row.page_rank_integer)
            : null,
      globalRank: row.rank != null ? Number(row.rank) : null,
      referringDomains: null,
      statusCode: row.status_code ?? null,
    });
  }
  return map;
}

if (!existsSync(inputPath)) {
  console.error(`Input not found: ${inputPath}`);
  console.error(
    "Run categorize-docs-with-llm.mjs first (or pass --input to a docs JSON).",
  );
  process.exit(1);
}

const { key, source } = resolveApiKey();
if (!key) {
  console.error(`No Open PageRank API key found.

Add one to the monorepo-root .env:
  OPENPAGERANK_API_KEY=...

Get a key from:
  - https://openpagerank.keywordseverywhere.com/  (provider ke, default)
  - or legacy DomCop Open PageRank (--provider legacy)
`);
  process.exit(1);
}

let entries = JSON.parse(readFileSync(inputPath, "utf8"));
if (!Array.isArray(entries)) {
  console.error("Input must be a JSON array.");
  process.exit(1);
}
if (limit != null) entries = entries.slice(0, limit);

console.log(`Using key from: ${source}`);
console.log(`Provider: ${provider}`);
console.log(`Sort: ${sortMode}`);
console.log(`Scoring ${entries.length} entries (docs URL domains)…`);

const domainByPkg = new Map();
const uniqueDomains = [];
const seenDomains = new Set();
let unscorable = 0;

for (const entry of entries) {
  const pkg = entry.package || entry.pkg;
  const domain = docsDomainForEntry(entry);
  domainByPkg.set(pkg, domain);
  if (!domain) {
    unscorable += 1;
    continue;
  }
  if (!seenDomains.has(domain)) {
    seenDomains.add(domain);
    uniqueDomains.push(domain);
  }
}

console.log(`Unique docs domains: ${uniqueDomains.length}`);
if (unscorable) {
  console.log(`No scorable docs domain (github/missing): ${unscorable}`);
}

const scores = new Map();
const batches = chunk(uniqueDomains, 100);
let batchIdx = 0;
for (const group of batches) {
  batchIdx += 1;
  process.stdout.write(`\r  OPR batch ${batchIdx}/${batches.length} (${group.length} domains)`);
  const map =
    provider === "legacy"
      ? await fetchLegacyBulk(key, group)
      : await fetchKeBulk(key, group);
  for (const [domain, row] of map) {
    scores.set(String(domain).replace(/^www\./, ""), row);
  }
  await sleep(250);
}
process.stdout.write("\n");

function cmpOprThenDownloads(a, b) {
  const av = a.openPageRank;
  const bv = b.openPageRank;
  if (av == null && bv == null) {
    return (b.downloadsLastMonth ?? 0) - (a.downloadsLastMonth ?? 0);
  }
  if (av == null) return 1;
  if (bv == null) return -1;
  if (bv !== av) return bv - av;
  return (b.downloadsLastMonth ?? 0) - (a.downloadsLastMonth ?? 0);
}

const annotated = entries.map((entry, idx) => {
  const pkg = entry.package || entry.pkg;
  const domain = domainByPkg.get(pkg);
  const score = domain ? scores.get(domain) : null;
  return {
    ...entry,
    listIndex: idx,
    docsDomain: domain,
    openPageRank: score?.openPageRank ?? null,
    openPageRankGlobalRank: score?.globalRank ?? null,
    referringDomains: score?.referringDomains ?? null,
  };
});

const byOpr = [...annotated].sort(cmpOprThenDownloads);
const oprRankByPkg = new Map();
byOpr.forEach((row, idx) => {
  oprRankByPkg.set(row.package || row.pkg, idx + 1);
});

let ranked = annotated.map((row) => ({
  ...row,
  oprRank: oprRankByPkg.get(row.package || row.pkg) ?? null,
}));

if (sortMode === "opr") {
  ranked = ranked.sort(cmpOprThenDownloads);
} else if (sortMode === "downloads") {
  ranked = ranked.sort(
    (a, b) => (b.downloadsLastMonth ?? 0) - (a.downloadsLastMonth ?? 0),
  );
} else {
  ranked = ranked.sort((a, b) => (a.listIndex ?? 0) - (b.listIndex ?? 0));
}

ranked = ranked
  .slice(0, topN == null ? undefined : topN)
  .map((row, idx) => {
    const { listIndex: _listIndex, ...rest } = row;
    return { ...rest, rank: idx + 1 };
  });

writeFileSync(outPath, `${JSON.stringify(ranked, null, 2)}\n`);

console.log("");
console.log("OPR#  OPR    Domain                         Package");
console.log("----  -----  -----------------------------  -------");
const preview = [...ranked]
  .sort(cmpOprThenDownloads)
  .slice(0, Math.min(25, ranked.length));
for (const row of preview) {
  const opr =
    row.openPageRank == null ? "  n/a" : String(row.openPageRank).padStart(5);
  console.log(
    `${String(row.oprRank ?? "-").padStart(4)}  ${opr}  ${String(row.docsDomain || "-").padEnd(29)}  ${row.package}`,
  );
}
if (ranked.length > 25) console.log(`… and ${ranked.length - 25} more`);
console.log("");
console.log(`Wrote ${ranked.length} → ${outPath}`);
