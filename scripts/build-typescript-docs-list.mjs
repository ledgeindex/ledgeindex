#!/usr/bin/env node
/**
 * Build / expand top-typescript-docs.json from npm (not GitHub stars).
 *
 * Logic (lean):
 *   1. Keep existing JSON rows
 *   2. npm search (github homepage OK) — ranking uses search's own
 *      downloads.monthly (no separate downloads API sweep)
 *   3. Enrich ONLY top ~limit packages: registry meta + docs resolve
 *      (homepage → README links → GitHub org / main site)
 *   4. Write top `--limit`
 *
 * Usage:
 *   node scripts/build-typescript-docs-list.mjs --limit 250
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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

const limit = Math.min(
  2000,
  Math.max(1, Number(argValue("--limit", 250)) || 250),
);
// Search scan can be wider (cheap). Metadata/docs enrich stays near limit.
const discoverCount = Math.min(
  2000,
  Math.max(
    limit,
    Number(argValue("--discover-count", Math.ceil(limit * 2))) ||
      Math.ceil(limit * 2),
  ),
);
const enrichCount = Math.min(
  discoverCount,
  Math.max(
    limit,
    Number(argValue("--enrich-count", Math.ceil(limit * 1.15))) ||
      Math.ceil(limit * 1.15),
  ),
);
const inputPath = resolve(
  process.cwd(),
  String(argValue("--input", resolve(ledgeRoot, "top-typescript-docs.json"))),
);
const outPath = resolve(
  process.cwd(),
  String(argValue("--out", resolve(ledgeRoot, "top-typescript-docs.json"))),
);
const uniqueDocs = !args.includes("--no-unique-docs");

const UA = "ledgeindex-docs-list";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** True when docs URL is a GitHub repo/blob/tree page (not a real docs site). */
function isGithubDocsUrl(input) {
  if (!input) return true;
  try {
    const raw = String(input).includes("://") ? input : `https://${input}`;
    const u = new URL(raw);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    // Keep GitHub Pages (*.github.io) — those are docs hosts.
    if (host.endsWith(".github.io")) return false;
    if (host === "github.com" || host === "githubusercontent.com") return true;
    if (host.endsWith(".githubusercontent.com")) return true;
    return false;
  } catch {
    return true;
  }
}

function normalizeDocsUrl(input) {
  if (!input) return null;
  try {
    const raw = String(input).includes("://") ? input : `https://${input}`;
    const u = new URL(raw);
    if (u.hostname.replace(/^www\./, "") === "github.com") {
      return null; // never keep github.com as docs
    }
    u.hash = "";
    u.search = "";
    return `${u.origin}${u.pathname}`.replace(/\/$/, "") || u.origin;
  } catch {
    return null;
  }
}

function githubRepoFromUrl(repoUrl) {
  if (!repoUrl) return null;
  const cleaned = String(repoUrl)
    .replace(/^git\+/, "")
    .replace(/^ssh:\/\//, "")
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/\.git$/, "");
  const m = cleaned.match(/github\.com[/:]([^/]+)\/([^/#?]+)/i);
  if (!m) return null;
  return `${m[1]}/${m[2]}`;
}

function isInfraPackage(name) {
  if (!name) return true;
  if (name.startsWith("@types/")) return true;
  if (
    /^(is-|has-|get-|set-|strip-|wrap-|path-|fs-|json-|cross-|npm-|node-)/i.test(
      name,
    ) &&
    !["node-fetch", "node-html-parser"].includes(name)
  ) {
    return true;
  }
  const infra = new Set([
    "uuid",
    "nanoid",
    "ms",
    "chalk",
    "debug",
    "semver",
    "minimatch",
    "glob",
    "rimraf",
    "wrappy",
    "once",
    "inherits",
    "safe-buffer",
    "string_decoder",
    "readable-stream",
    "source-map",
    "source-map-js",
    "picocolors",
    "tslib",
    "scheduler",
    "loose-envify",
    "object-assign",
    "prop-types",
    "react-is",
    "csstype",
    "type-fest",
    "ajv",
    "clsx",
    "postcss",
    "ws",
    "undici",
    "rollup",
    "acorn",
    "yallist",
    "lru-cache",
  ]);
  return infra.has(name);
}

function isJunkPackage(name) {
  const n = String(name).toLowerCase();
  return (
    n.includes("boilerplate") ||
    n.includes("starter") ||
    n.includes("template") ||
    n.includes("example") ||
    n.endsWith("-demo") ||
    n.startsWith("create-") ||
    /^eslint-config-/.test(n) ||
    /^eslint-plugin-/.test(n) ||
    n.includes("cra-template")
  );
}

function looksTypescriptRelated(pkg, meta) {
  const name = pkg.name || pkg;
  if (isJunkPackage(name)) return false;
  const keywords = [
    ...(Array.isArray(pkg.keywords) ? pkg.keywords : []),
    ...(Array.isArray(meta?.keywords) ? meta.keywords : []),
  ].map((k) => String(k).toLowerCase());
  const desc = `${meta?.description || pkg.description || ""}`.toLowerCase();
  const types = meta?.types;
  if (types) return true;
  if (keywords.some((k) => k.includes("typescript") || k === "ts" || k === "types")) {
    return true;
  }
  if (/\btypescript\b|\btype[ -]?safe\b|\btyped\b/.test(desc)) return true;
  // Keep popular JS packages that TS apps look up docs for.
  if (
    /^(react|vue|svelte|express|next|nuxt|vite|webpack|eslint|jest|vitest|zod|axios|lodash|cheerio|jsdom|playwright|cypress|prisma|mongoose|redux|graphql|langchain|langsmith|langgraph)/i.test(
      name,
    ) ||
    /^@langchain\//i.test(name)
  ) {
    return true;
  }
  return Boolean(meta?.hasTypesHint);
}

function extractUrlsFromText(text) {
  if (!text) return [];
  const out = [];
  const re = /https?:\/\/[^\s)\]"'<>]+/gi;
  let m;
  while ((m = re.exec(text))) {
    out.push(m[0].replace(/[.,;:]+$/g, ""));
  }
  return out;
}

function isNoiseDocsUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    const path = u.pathname.toLowerCase();
    if (
      host === "npmjs.com" ||
      host.endsWith(".npmjs.com") ||
      host === "img.shields.io" ||
      host === "shields.io" ||
      host === "badge.fury.io" ||
      host === "travis-ci.org" ||
      host === "travis-ci.com" ||
      host === "codecov.io" ||
      host === "coveralls.io" ||
      host === "twitter.com" ||
      host === "x.com" ||
      host === "linkedin.com" ||
      host === "youtube.com" ||
      host === "youtu.be" ||
      host === "discord.gg" ||
      host === "discord.com" ||
      host === "opensource.org" ||
      host === "spdx.org" ||
      host === "creativecommons.org"
    ) {
      return true;
    }
    if (path.includes("/licenses/") || path.includes("/license")) return true;
    if (host === "github.com") return true;
    return false;
  } catch {
    return true;
  }
}

/** Higher = better docs candidate. */
function scoreDocsCandidate(url, packageName = "") {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    const path = u.pathname.toLowerCase();
    const pkg = String(packageName).toLowerCase().replace(/^@/, "");
    const brand = pkg.split("/")[0] || pkg;
    let score = 0;
    if (host.startsWith("docs.")) score += 80;
    if (host.endsWith(".github.io")) score += 50;
    if (path.includes("/docs") || path.includes("/documentation")) score += 40;
    if (path.includes("/overview") || /\/docs\/?$/.test(path)) score += 35;
    if (path.includes("/learn") || path.includes("/guide") || path.includes("/guides")) {
      score += 15;
    }
    if (/\/(api|reference|tutorial)/i.test(path)) score += 20;
    // npm packages are JS/TS — prefer those trees over sibling language docs.
    if (
      path.includes("/javascript") ||
      path.includes("/typescript") ||
      path.includes("/js/")
    ) {
      score += 30;
    }
    if (path.includes("/python") || path.includes("/py/")) score -= 25;
    if (brand && host.includes(brand.replace(/[^a-z0-9]/g, ""))) score += 25;
    if (host.includes("langchain")) score += 15;
    if (path === "/" || path === "") score += 5;
    if (isNoiseDocsUrl(url) || isGithubDocsUrl(url)) return -1;
    return score;
  } catch {
    return -1;
  }
}

function pickBestDocsUrl(urls, packageName) {
  let best = null;
  let bestScore = -1;
  for (const raw of urls) {
    const normalized = normalizeDocsUrl(raw);
    if (!normalized || isGithubDocsUrl(normalized) || isNoiseDocsUrl(normalized)) {
      continue;
    }
    const score = scoreDocsCandidate(normalized, packageName);
    if (score > bestScore) {
      bestScore = score;
      best = normalized;
    }
  }
  return best;
}

async function fetchHtml(url, timeoutMs = 12_000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) return null;
    const text = await res.text();
    return { finalUrl: res.url, text };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function extractHrefCandidates(html, baseUrl) {
  if (!html) return [];
  const hrefs = [];
  const re = /href\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    const raw = m[1].trim();
    if (!raw || raw.startsWith("#") || raw.startsWith("mailto:") || raw.startsWith("javascript:")) {
      continue;
    }
    try {
      hrefs.push(new URL(raw, baseUrl).toString());
    } catch {
      // ignore
    }
  }
  return hrefs;
}

function isAssetUrl(url) {
  return (
    /\.(woff2?|ttf|eot|css|js|mjs|map|png|jpe?g|gif|svg|webp|ico)(\?|$)/i.test(
      url,
    ) || /\/(_next|mintlify-assets|static\/chunks)\//i.test(url)
  );
}

/**
 * When npm homepage is GitHub (or missing), inspect the project's main site
 * for a docs entry point (e.g. langchain.com → js.langchain.com / docs.langchain.com).
 */
async function resolveDocsFromMainSite(repositoryUrl, packageName) {
  const repo = githubRepoFromUrl(repositoryUrl);
  if (!repo) return null;
  const owner = repo.split("/")[0];
  if (!owner) return null;

  const orgPage = await fetchHtml(`https://github.com/${owner}`);
  if (!orgPage) return null;

  const siteCandidates = [];
  const propUrl =
    orgPage.text.match(
      /itemprop="url"[^>]*href="(https?:\/\/[^"]+)"/i,
    ) ||
    orgPage.text.match(
      /href="(https?:\/\/[^"]+)"[^>]*itemprop="url"/i,
    );
  if (propUrl?.[1] && !isGithubDocsUrl(propUrl[1])) {
    siteCandidates.push(propUrl[1]);
  }
  for (const url of extractUrlsFromText(orgPage.text)) {
    if (!isGithubDocsUrl(url) && !isNoiseDocsUrl(url) && !isAssetUrl(url)) {
      siteCandidates.push(url);
    }
  }

  const mainSite =
    pickBestDocsUrl(siteCandidates, packageName) ||
    normalizeDocsUrl(siteCandidates[0]);
  if (!mainSite) return null;

  let origin;
  let baseDomain;
  try {
    const u = new URL(mainSite);
    origin = u.origin;
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    const parts = host.split(".");
    baseDomain = parts.length >= 2 ? parts.slice(-2).join(".") : host;
  } catch {
    return null;
  }

  // Prefer language-appropriate docs hosts before marketing /docs redirects
  // (langchain.com/docs currently lands on the Python tree).
  const probeUrls = [
    `https://js.${baseDomain}/`,
    `https://docs.${baseDomain}/`,
    `https://docs.${baseDomain}/oss/javascript/`,
    `${origin}/docs`,
    `${origin}/documentation`,
    `${origin}/learn`,
    mainSite,
  ];

  const found = [];
  for (const probe of probeUrls) {
    const page = await fetchHtml(probe);
    if (!page) continue;
    if (!isAssetUrl(page.finalUrl)) found.push(page.finalUrl);
    for (const href of extractHrefCandidates(page.text, page.finalUrl)) {
      if (isAssetUrl(href) || isNoiseDocsUrl(href) || isGithubDocsUrl(href)) {
        continue;
      }
      const host = (() => {
        try {
          return new URL(href).hostname.replace(/^www\./, "").toLowerCase();
        } catch {
          return "";
        }
      })();
      if (
        /docs|documentation|learn|reference|guide|javascript|typescript/i.test(
          href,
        ) ||
        host.startsWith("docs.") ||
        host.startsWith("js.")
      ) {
        found.push(href);
      }
    }
    if (found.length > 0) {
      const picked = pickBestDocsUrl(found, packageName);
      if (picked) return picked;
    }
  }

  return pickBestDocsUrl(found, packageName);
}

async function resolveDocsUrl({
  packageName,
  existingDocs,
  homepage,
  repository,
  readme,
}) {
  // 1. Already-known non-github docs
  let docs = normalizeDocsUrl(existingDocs);
  if (docs && !isGithubDocsUrl(docs)) return { docs, source: "existing" };

  // 2. npm homepage if it is a real site
  docs = normalizeDocsUrl(homepage);
  if (docs && !isGithubDocsUrl(docs)) return { docs, source: "homepage" };

  // 3. Links from npm README (often has the real docs URL)
  const fromReadme = pickBestDocsUrl(extractUrlsFromText(readme), packageName);
  if (fromReadme) return { docs: fromReadme, source: "readme" };

  // 4. GitHub org/user website → inspect for /docs
  const fromSite = await resolveDocsFromMainSite(repository, packageName);
  if (fromSite) return { docs: fromSite, source: "main-site" };

  return { docs: null, source: null };
}

async function discoverPopularNpmPackages(count) {
  const found = [];
  const seen = new Set();
  // Scan each query deeply — do not stop after the first query fills `count`,
  // or high-download packages deep in later queries (e.g. langchain) get skipped.
  const hardCap = Math.min(2000, Math.max(count, Math.ceil(count * 1.5)));
  const queries = [
    // High-signal scoped families first so they aren't skipped when the scan caps.
    "@langchain",
    "typescript",
    "keywords:typescript",
    "keywords:react",
    "keywords:nodejs",
    "popularity-weight:1.0 quality-weight:0.0 maintenance-weight:0.0 typescript",
  ];
  for (const text of queries) {
    let from = 0;
    while (found.length < hardCap && from < 1000) {
      const size = Math.min(250, hardCap - found.length + 40);
      const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(text)}&size=${size}&from=${from}`;
      const res = await fetch(url, {
        headers: {
          "User-Agent": UA,
          Accept: "application/json",
        },
      });
      if (!res.ok) {
        await sleep(1000);
        break;
      }
      const data = await res.json();
      const objects = Array.isArray(data.objects) ? data.objects : [];
      if (objects.length === 0) break;
      for (const obj of objects) {
        const pkg = obj?.package;
        const name = pkg?.name;
        if (!name || seen.has(name) || isInfraPackage(name) || isJunkPackage(name)) {
          continue;
        }
        seen.add(name);
        const links = pkg.links || {};
        const homepage = links.homepage || null;
        const docsCandidate = normalizeDocsUrl(homepage);
        const monthly = Number(obj.downloads?.monthly) || 0;
        // Keep github-only / missing homepage — resolve docs later from README / main site.
        found.push({
          package: name,
          docs:
            docsCandidate && !isGithubDocsUrl(docsCandidate)
              ? docsCandidate
              : null,
          homepage,
          description: pkg.description || null,
          discovered: true,
          keywords: pkg.keywords || [],
          downloadsLastMonth: monthly,
          npmSearchScore: obj.score?.detail?.popularity ?? 0,
          needsDocsResolve:
            !docsCandidate || isGithubDocsUrl(docsCandidate),
        });
        if (found.length >= hardCap) break;
      }
      from += objects.length;
      await sleep(200);
      if (objects.length < size) break;
    }
    if (found.length >= hardCap) break;
  }
  found.sort(
    (a, b) => (b.downloadsLastMonth ?? 0) - (a.downloadsLastMonth ?? 0),
  );
  return found;
}

async function fetchJsonWithRetry(url, tries = 12) {
  let lastErr = null;
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "application/json",
      },
    });
    if (res.status === 429 || res.status >= 500) {
      const wait = Math.min(60_000, 1500 * 2 ** Math.min(attempt - 1, 5));
      await sleep(wait);
      lastErr = new Error(`HTTP ${res.status} for ${url}`);
      continue;
    }
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Request failed (${res.status}): ${body.slice(0, 300)}`);
    }
    return res.json();
  }
  throw lastErr || new Error(`Failed after retries: ${url}`);
}

async function fetchDownloads(packages) {
  const out = {};
  const unscoped = packages.filter((p) => !p.startsWith("@"));
  const scoped = packages.filter((p) => p.startsWith("@"));
  let done = 0;

  for (const group of chunk(unscoped, 16)) {
    if (group.length === 0) continue;
    const url = `https://api.npmjs.org/downloads/point/last-month/${group
      .map(encodeURIComponent)
      .join(",")}`;
    try {
      const data = await fetchJsonWithRetry(url);
      if (data && typeof data === "object" && "downloads" in data && "package" in data) {
        out[data.package] = data;
      } else {
        Object.assign(out, data);
      }
    } catch (err) {
      console.warn(`\n  download batch failed, retrying one-by-one: ${err.message}`);
      for (const pkg of group) {
        try {
          out[pkg] = await fetchJsonWithRetry(
            `https://api.npmjs.org/downloads/point/last-month/${encodeURIComponent(pkg)}`,
          );
        } catch {
          out[pkg] = { package: pkg, downloads: 0 };
        }
        await sleep(300);
      }
    }
    done += group.length;
    process.stdout.write(`\r  downloads ${done}/${packages.length}`);
    await sleep(400);
  }

  for (const group of chunk(scoped, 2)) {
    await Promise.all(
      group.map(async (pkg) => {
        const url = `https://api.npmjs.org/downloads/point/last-month/${encodeURIComponent(pkg)}`;
        try {
          out[pkg] = await fetchJsonWithRetry(url);
        } catch {
          out[pkg] = { package: pkg, downloads: 0 };
        }
      }),
    );
    done += group.length;
    process.stdout.write(`\r  downloads ${done}/${packages.length}`);
    await sleep(500);
  }
  process.stdout.write("\n");
  return out;
}

async function fetchNpmMeta(pkg) {
  const scopedUrl = pkg.startsWith("@")
    ? `https://registry.npmjs.org/${pkg}`
    : `https://registry.npmjs.org/${encodeURIComponent(pkg)}`;
  const res = await fetch(scopedUrl, {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const latest = data["dist-tags"]?.latest;
  const version = latest ? data.versions?.[latest] : null;
  const repoUrl =
    typeof data.repository === "string"
      ? data.repository
      : data.repository?.url || version?.repository?.url || null;
  const homepage = data.homepage || version?.homepage || null;
  return {
    description: data.description || version?.description || null,
    homepage,
    repository: repoUrl,
    latest,
    keywords: data.keywords || version?.keywords || [],
    readme: typeof data.readme === "string" ? data.readme : "",
    types:
      version?.types ||
      version?.typings ||
      (version?.typesVersions ? "typesVersions" : null) ||
      null,
  };
}

function loadExisting(path) {
  if (!existsSync(path)) return [];
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function collapseByDocs(rows) {
  const byDocs = new Map();
  for (const row of rows) {
    // Collapse by docs host+first path segment so js.langchain.com and
    // docs.langchain.com/oss/... still keep separate trees when useful,
    // but identical URLs collapse to the highest-download package.
    const key = (row.docs || "").toLowerCase();
    if (!key) continue;
    const prev = byDocs.get(key);
    if (!prev || (row.downloadsLastMonth ?? 0) > (prev.downloadsLastMonth ?? 0)) {
      byDocs.set(key, row);
    }
  }
  return [...byDocs.values()];
}

// --- main ---
const byPkg = new Map();

const existing = loadExisting(inputPath);
let keptFromJson = 0;
for (const row of existing) {
  const name = row.package || row.pkg;
  if (!name || isInfraPackage(name)) continue;
  const docsRaw = normalizeDocsUrl(row.docs);
  const docs =
    docsRaw && !isGithubDocsUrl(docsRaw) ? docsRaw : null;
  byPkg.set(name, {
    package: name,
    docs,
    homepage: row.homepage || docs,
    description: row.description || null,
    category: row.category || null,
    github: row.github || null,
    downloadsLastMonth: row.downloadsLastMonth ?? 0,
    discovered: Boolean(row.discovered),
    fromJson: true,
    needsDocsResolve: !docs,
  });
  keptFromJson += 1;
}
console.log(`Loaded JSON: kept ${keptFromJson} (docs re-resolved if missing)`);

console.log(
  `Discovering npm packages (scan ≤${discoverCount}, enrich ${enrichCount}, final ${limit})…`,
);
const discovered = await discoverPopularNpmPackages(discoverCount);
let added = 0;
for (const row of discovered) {
  if (byPkg.has(row.package)) {
    // Refresh download hint from search when present.
    if ((row.downloadsLastMonth ?? 0) > (byPkg.get(row.package).downloadsLastMonth ?? 0)) {
      byPkg.get(row.package).downloadsLastMonth = row.downloadsLastMonth;
    }
    continue;
  }
  byPkg.set(row.package, { ...row, fromJson: false });
  added += 1;
}
console.log(`  +${added} candidates (pool ${byPkg.size})`);

// Rank by search monthly downloads, enrich ONLY top slice (no mass downloads API).
{
  const rankedPool = [...byPkg.values()].sort(
    (a, b) => (b.downloadsLastMonth ?? 0) - (a.downloadsLastMonth ?? 0),
  );
  const keep = rankedPool.slice(0, enrichCount);
  byPkg.clear();
  for (const row of keep) byPkg.set(row.package, row);
  console.log(
    `  enriching ${byPkg.size} packages (registry meta + docs resolve only)`,
  );
}

const packages = [...byPkg.keys()];
console.log("Fetching npm metadata + resolving docs URLs…");
let metaDone = 0;
let droppedNoDocs = 0;
let resolvedFrom = { existing: 0, homepage: 0, readme: 0, "main-site": 0 };
for (const group of chunk(packages, 3)) {
  await Promise.all(
    group.map(async (pkg) => {
      const entry = byPkg.get(pkg);
      const meta = await fetchNpmMeta(pkg);
      entry.meta = meta;
      entry.github = githubRepoFromUrl(meta?.repository || null) || entry.github;
      entry.description = meta?.description || entry.description || null;
      entry.latest = meta?.latest || null;
      entry.hasTypesHint = Boolean(meta?.types) || pkg === "typescript";
      entry.homepage = meta?.homepage || entry.homepage || null;

      const resolved = await resolveDocsUrl({
        packageName: pkg,
        existingDocs: entry.docs,
        homepage: meta?.homepage || entry.homepage,
        repository: meta?.repository,
        readme: meta?.readme || "",
      });

      if (!resolved.docs) {
        entry.docs = null;
        entry.keep = false;
        entry.docsSource = null;
        droppedNoDocs += 1;
        return;
      }

      entry.docs = resolved.docs;
      entry.docsSource = resolved.source;
      if (resolved.source && resolvedFrom[resolved.source] != null) {
        resolvedFrom[resolved.source] += 1;
      }
      entry.keep = looksTypescriptRelated(
        { name: pkg, keywords: entry.keywords, description: entry.description },
        meta,
      );
      if (!entry.keep) droppedNoDocs += 1;
    }),
  );
  metaDone += group.length;
  process.stdout.write(`\r  metadata ${metaDone}/${packages.length}`);
  await sleep(250);
}
process.stdout.write("\n");
console.log(`  docs sources: ${JSON.stringify(resolvedFrom)}`);

let ranked = [...byPkg.values()]
  .filter((row) => row.keep && row.docs)
  .map((row) => ({
    package: row.package,
    category: row.category || null,
    role: "docs",
    discovered: Boolean(row.discovered) && !row.fromJson,
    downloadsLastMonth: row.downloadsLastMonth ?? 0,
    docs: row.docs,
    docsSource: row.docsSource || null,
    homepage: row.homepage || row.docs,
    github: row.github || null,
    stars: null,
    description: row.description || null,
    latest: row.latest || null,
    hasTypesHint: Boolean(row.hasTypesHint),
  }));

if (uniqueDocs) ranked = collapseByDocs(ranked);

ranked = ranked
  .sort((a, b) => b.downloadsLastMonth - a.downloadsLastMonth)
  .slice(0, limit)
  .map((row, idx) => ({ rank: idx + 1, ...row }));

writeFileSync(outPath, `${JSON.stringify(ranked, null, 2)}\n`);

const githubLeft = ranked.filter((r) => isGithubDocsUrl(r.docs)).length;
const langchainHits = ranked.filter((r) =>
  /langchain|langsmith|langgraph/i.test(r.package),
);
console.log("");
console.log(`Wrote ${ranked.length} packages → ${outPath}`);
console.log(`Dropped (no real docs / not TS-ish): ~${droppedNoDocs}`);
console.log(`github.com docs remaining: ${githubLeft} (should be 0)`);
if (langchainHits.length) {
  console.log("LangChain family in list:");
  for (const row of langchainHits) {
    console.log(
      `  #${row.rank} ${row.package} (${row.downloadsLastMonth}/mo) → ${row.docs} [${row.docsSource}]`,
    );
  }
} else {
  console.log("LangChain family: not in final list (check discover pool / resolves)");
}
console.log("");
console.log("Rank  Downloads/mo   Package                          Docs");
console.log("----  -------------  -------------------------------  ----");
for (const row of ranked.slice(0, 25)) {
  console.log(
    `${String(row.rank).padStart(4)}  ${String(row.downloadsLastMonth).padStart(13)}  ${row.package.padEnd(31)}  ${row.docs}`,
  );
}
if (ranked.length > 25) console.log(`… and ${ranked.length - 25} more`);
