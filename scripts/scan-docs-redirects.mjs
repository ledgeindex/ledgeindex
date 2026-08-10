#!/usr/bin/env node
/**
 * Scan docs URLs for HTTP redirects. Sets filterable flags on each row:
 *   isRedirect            — docs URL changed after following redirects
 *   finalDocsUrl          — URL after redirects (null if probe failed)
 *   redirectUncrawlable   — final host is GitHub/npm/etc (not crawlable docs)
 *
 * Usage (from ledgeindex/):
 *   node scripts/scan-docs-redirects.mjs --limit 20 --concurrency 8
 *   node scripts/scan-docs-redirects.mjs --resume --concurrency 8
 *   node scripts/scan-docs-redirects.mjs --package jiti
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ledgeRoot = resolve(__dirname, "..");

const args = process.argv.slice(2);
function argValue(flag, fallback = null) {
  const i = args.findIndex((a) => a === flag);
  if (i === -1) return fallback;
  const next = args[i + 1];
  if (!next || next.startsWith("-")) return true;
  return next;
}

const inputPath = resolve(
  process.cwd(),
  String(argValue("--input", resolve(ledgeRoot, "top-typescript-docs.json"))),
);
const outPath = resolve(process.cwd(), String(argValue("--out", inputPath)));
const checkpointPath = resolve(
  process.cwd(),
  String(
    argValue(
      "--checkpoint",
      resolve(ledgeRoot, ".cache/docs-redirect-scan-checkpoint.json"),
    ),
  ),
);
const summaryPath = resolve(
  process.cwd(),
  String(
    argValue(
      "--summary",
      resolve(ledgeRoot, ".cache/docs-redirect-scan-summary.json"),
    ),
  ),
);
const resume = args.includes("--resume");
const packageFilter = argValue("--package", null);
const limitRaw = argValue("--limit", null);
const limit = limitRaw == null ? null : Math.max(1, Number(limitRaw) || 1);
const concurrency = Math.min(
  16,
  Math.max(1, Number(argValue("--concurrency", 8)) || 8),
);
const timeoutMs = Math.min(
  60_000,
  Math.max(5_000, Number(argValue("--timeout-ms", 12_000)) || 12_000),
);

const USER_AGENT =
  "Mozilla/5.0 (compatible; LedgeIndexRedirectScan/0.1; +https://ledgeindex.dev)";

function normalizeUrl(input) {
  if (!input) return null;
  try {
    const raw = String(input).includes("://") ? input : `https://${input}`;
    const u = new URL(raw);
    u.hash = "";
    return u.toString().replace(/\/$/, "") || u.origin;
  } catch {
    return null;
  }
}

function isUncrawlableDocsHost(input) {
  if (!input) return false;
  try {
    const host = new URL(input).hostname.replace(/^www\./, "").toLowerCase();
    if (host.endsWith(".github.io")) return false;
    if (
      host === "github.com" ||
      host === "githubusercontent.com" ||
      host.endsWith(".githubusercontent.com")
    ) {
      return true;
    }
    if (
      host === "npmjs.com" ||
      host === "npmjs.org" ||
      host === "registry.npmjs.org" ||
      host === "yarnpkg.com"
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function resolveFinalUrl(url) {
  const requested = normalizeUrl(url) || url;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let res = await fetch(requested, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, Accept: "*/*" },
    });
    if (res.status === 405 || res.status === 501 || res.status === 403) {
      res = await fetch(requested, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
      });
    }
    const finalUrl = normalizeUrl(res.url) || requested;
    return {
      ok: res.ok,
      status: res.status,
      requestedUrl: requested,
      finalUrl,
      isRedirect: requested !== finalUrl,
      redirectUncrawlable: isUncrawlableDocsHost(finalUrl),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      requestedUrl: requested,
      finalUrl: null,
      isRedirect: false,
      redirectUncrawlable: isUncrawlableDocsHost(requested),
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function loadCheckpoint() {
  if (!resume || !existsSync(checkpointPath)) return { results: {} };
  try {
    return JSON.parse(readFileSync(checkpointPath, "utf8"));
  } catch {
    return { results: {} };
  }
}

function saveCheckpoint(state) {
  mkdirSync(dirname(checkpointPath), { recursive: true });
  writeFileSync(
    checkpointPath,
    `${JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2)}\n`,
  );
}

if (!existsSync(inputPath)) {
  console.error(`Input not found: ${inputPath}`);
  process.exit(1);
}

const fullInput = JSON.parse(readFileSync(inputPath, "utf8"));
if (!Array.isArray(fullInput)) {
  console.error("Input must be a JSON array");
  process.exit(1);
}

let entries = fullInput.filter((row) => row?.package || row?.pkg);
if (packageFilter) {
  const want = String(packageFilter).toLowerCase();
  entries = entries.filter(
    (row) => String(row.package || row.pkg || "").toLowerCase() === want,
  );
}
entries = entries.filter((row) => normalizeUrl(row.docs));
if (limit != null) entries = entries.slice(0, limit);

const checkpoint = loadCheckpoint();
const results = { ...(checkpoint.results || {}) };
let checkpointChain = Promise.resolve();
function saveSafe() {
  checkpointChain = checkpointChain.then(() => saveCheckpoint({ results }));
  return checkpointChain;
}

const started = Date.now();
console.log(`Entries:     ${entries.length}`);
console.log(`Concurrency: ${concurrency}`);
console.log(`Timeout:     ${Math.round(timeoutMs / 1000)}s`);
console.log(`Resume:      ${resume ? "yes" : "no"}`);
console.log("");

let done = 0;
async function scanOne(entry) {
  const pkg = entry.package || entry.pkg;
  if (results[pkg]?.scanned) {
    done += 1;
    return results[pkg];
  }
  const docs = normalizeUrl(entry.docs);
  const probe = await resolveFinalUrl(docs);
  const row = {
    package: pkg,
    scanned: true,
    docs,
    isRedirect: Boolean(probe.isRedirect),
    finalDocsUrl: probe.finalUrl,
    redirectUncrawlable: Boolean(probe.redirectUncrawlable),
    redirectStatus: probe.status,
    redirectError: probe.error || null,
  };
  results[pkg] = row;
  await saveSafe();
  done += 1;
  const flag = row.redirectUncrawlable
    ? "UNCRAWLABLE"
    : row.isRedirect
      ? "redirect"
      : "ok";
  console.log(
    `[${String(done).padStart(3)}/${entries.length}] ${pkg} → ${flag}` +
      (row.isRedirect ? `  ${docs} ⇒ ${row.finalDocsUrl}` : ""),
  );
  return row;
}

for (const group of chunk(entries, concurrency)) {
  await Promise.all(group.map((entry) => scanOne(entry)));
}
await checkpointChain;

const output = fullInput.map((entry) => {
  const pkg = entry.package || entry.pkg;
  const row = results[pkg];
  if (!row?.scanned) return entry;
  return {
    ...entry,
    isRedirect: row.isRedirect,
    finalDocsUrl: row.finalDocsUrl,
    redirectUncrawlable: row.redirectUncrawlable,
    redirectStatus: row.redirectStatus ?? null,
    redirectError: row.redirectError || null,
  };
});

writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`);

const scanned = Object.values(results).filter((r) => r.scanned);
const redirects = scanned.filter((r) => r.isRedirect);
const uncrawlable = scanned.filter((r) => r.redirectUncrawlable);
const summary = {
  generatedAt: new Date().toISOString(),
  scanned: scanned.length,
  redirects: redirects.length,
  uncrawlable: uncrawlable.length,
  redirectPackages: redirects.map((r) => ({
    package: r.package,
    docs: r.docs,
    finalDocsUrl: r.finalDocsUrl,
    redirectUncrawlable: r.redirectUncrawlable,
  })),
  uncrawlablePackages: uncrawlable.map((r) => ({
    package: r.package,
    docs: r.docs,
    finalDocsUrl: r.finalDocsUrl,
  })),
};
mkdirSync(dirname(summaryPath), { recursive: true });
writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);

console.log("");
console.log(`Scanned:      ${scanned.length}`);
console.log(`isRedirect:   ${redirects.length}`);
console.log(`uncrawlable:  ${uncrawlable.length}`);
if (uncrawlable.length) {
  console.log("Uncrawlable redirects:");
  for (const row of uncrawlable.slice(0, 20)) {
    console.log(`  - ${row.package}: ${row.docs} → ${row.finalDocsUrl}`);
  }
}
console.log(`Done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log(`Wrote → ${outPath}`);
console.log(`Summary → ${summaryPath}`);
