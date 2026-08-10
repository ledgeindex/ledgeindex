#!/usr/bin/env node
/**
 * Propose docs crawl exclude patterns from a sitemap (default) or crawl.
 *
 * Default (sitemap-only, no HTML crawl):
 *   1. Fetch sitemap URL list for the docs origin
 *   2. Agent inspects path clusters / version-like trees
 *   3. Writes excludePatterns + versions
 *
 * Optional --crawl: also run LedgeIndex HTML discovery (slower; can hang).
 * Optional --browser / --headed: Stagehand nav inspection.
 *
 * Usage (from ledgeindex/):
 *   node scripts/propose-docs-exclude-patterns.mjs --url "https://example.com/docs"
 *   node scripts/propose-docs-exclude-patterns.mjs --url "…" --sitemap-only
 *   node scripts/propose-docs-exclude-patterns.mjs --url "…" --crawl --max-pages 200
 *   node scripts/propose-docs-exclude-patterns.mjs --url "…" --out ./exclude-test.json
 *
 * Env: DEEPSEEK_API_KEY (monorepo-root or ledgeindex .env)
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ledgeRoot = resolve(__dirname, "..");
const monoRoot = resolve(ledgeRoot, "..");
const require = createRequire(import.meta.url);

const DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-flash";
const USER_AGENT =
  "Mozilla/5.0 (compatible; LedgeIndexExcludeProposer/0.1; +https://ledgeindex.dev)";

function loadFromCandidates(moduleId, roots) {
  const errors = [];
  for (const root of roots) {
    try {
      const req = createRequire(join(root, "package.json"));
      return req(moduleId);
    } catch (err) {
      errors.push(`${root}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  try {
    return require(moduleId);
  } catch (err) {
    errors.push(`script: ${err instanceof Error ? err.message : String(err)}`);
  }
  throw new Error(`Could not resolve ${moduleId}.\n  - ${errors.join("\n  - ")}`);
}

const resolveRoots = [
  ledgeRoot,
  join(ledgeRoot, "packages", "docs"),
  join(ledgeRoot, "packages", "core"),
  join(monoRoot, "agents-content"),
  monoRoot,
];

const { createOpenAI } = loadFromCandidates("@ai-sdk/openai", resolveRoots);
const { generateText, tool, stepCountIs, hasToolCall } = loadFromCandidates(
  "ai",
  resolveRoots,
);
const { z } = loadFromCandidates("zod", resolveRoots);

async function loadLedgeindexCrawlHelpers() {
  const discoverPath = join(ledgeRoot, "packages/core/dist/crawl/discover.js");
  const sitemapPath = join(ledgeRoot, "packages/core/dist/crawl/sitemap.js");
  if (!existsSync(discoverPath) || !existsSync(sitemapPath)) {
    throw new Error(
      "Missing @ledgeindex/core dist. Run: npm run build -w @ledgeindex/core",
    );
  }
  const [discoverMod, sitemapMod] = await Promise.all([
    import(pathToFileURL(discoverPath).href),
    import(pathToFileURL(sitemapPath).href),
  ]);
  return {
    discoverUrls: discoverMod.discoverUrls,
    discoverSitemapUrls: sitemapMod.discoverSitemapUrls,
  };
}

const { discoverUrls, discoverSitemapUrls } =
  await loadLedgeindexCrawlHelpers();

const args = process.argv.slice(2);
function argValue(flag, fallback = null) {
  const i = args.findIndex((a) => a === flag);
  if (i === -1) return fallback;
  const next = args[i + 1];
  if (!next || next.startsWith("-")) return true;
  return next;
}

const startUrl = String(argValue("--url", "") || "").trim();
if (!startUrl) {
  console.error(`Missing --url

Example:
  node scripts/propose-docs-exclude-patterns.mjs --url "https://example.com/docs/intro"
`);
  process.exit(1);
}

const outPath = resolve(
  process.cwd(),
  String(
    argValue("--out", resolve(ledgeRoot, "docs-exclude-patterns.test.json")),
  ),
);

/** Default is sitemap-only. Pass --crawl for HTML crawl discovery. */
const useCrawl = args.includes("--crawl");
const useBrowser =
  args.includes("--browser") ||
  args.includes("--headed");
const headed = args.includes("--headed");

const maxPages = Math.min(
  useCrawl ? 500 : 5000,
  Math.max(
    30,
    Number(argValue("--max-pages", useCrawl ? 180 : 2000)) ||
      (useCrawl ? 180 : 2000),
  ),
);
const maxSteps = Math.max(3, Number(argValue("--max-steps", 8)) || 8);
const modelFlag = argValue("--model", null);
const DISCOVER_TIMEOUT_MS = Math.max(
  30_000,
  Number(argValue("--discover-timeout-ms", 90_000)) || 90_000,
);

const resultSchema = z.object({
  excludePatterns: z
    .array(z.string().min(1))
    .max(40)
    .describe(
      "LedgeIndex excludePatterns: path/URL substrings (or regex if patternsAreRegex). Prefer compact path prefixes that drop whole unwanted trees.",
    ),
  patternsAreRegex: z
    .boolean()
    .describe(
      "true if excludePatterns are JS regexes; false for substring includes",
    ),
  versions: z
    .array(z.string().min(1))
    .min(1)
    .max(30)
    .describe(
      'Doc versions available on this site. Always include "latest" for the primary/current tree. Add other version labels only when parallel version trees exist.',
    ),
  confidence: z.number().min(0).max(1),
  notes: z.string().max(500).describe("Short note on excludes / versions"),
  keepExamples: z
    .array(z.string().url())
    .max(8)
    .optional()
    .describe("A few example URLs that should remain after excludes"),
  dropExamples: z
    .array(z.string().url())
    .max(8)
    .optional()
    .describe("A few example URLs that the excludes are meant to remove"),
});

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const out = {};
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

function resolveDeepseekKey() {
  const fromEnv = process.env.DEEPSEEK_API_KEY?.trim();
  if (fromEnv) return { key: fromEnv, source: "env:DEEPSEEK_API_KEY" };
  for (const root of [monoRoot, ledgeRoot]) {
    const parsed = loadEnvFile(resolve(root, ".env"));
    const value = parsed.DEEPSEEK_API_KEY?.trim();
    if (value) return { key: value, source: `${root}/.env (DEEPSEEK_API_KEY)` };
  }
  return { key: "", source: null };
}

function matchesExclude(url, patterns, patternsAreRegex) {
  for (const pattern of patterns) {
    if (!pattern) continue;
    if (patternsAreRegex) {
      try {
        if (new RegExp(pattern).test(url)) return true;
      } catch {
        // ignore bad regex
      }
    } else if (url.includes(pattern)) {
      return true;
    }
  }
  return false;
}

function pathPrefixClusters(urls, limit = 40) {
  const counts = new Map();
  for (const url of urls) {
    try {
      const u = new URL(url);
      const parts = u.pathname.split("/").filter(Boolean);
      let cur = "";
      for (let i = 0; i < Math.min(parts.length, 4); i += 1) {
        cur += `/${parts[i]}`;
        counts.set(cur, (counts.get(cur) || 0) + 1);
      }
    } catch {
      // skip
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([prefix, count]) => ({ prefix, count }));
}

function suspiciousPathHints(urls) {
  const hints = new Map();
  const re =
    /\/(next|canary|beta|alpha|preview|nightly|unstable|legacy|archive|old|v\d+|versions?|release-\d+)(\/|$)/i;
  for (const url of urls) {
    try {
      const path = new URL(url).pathname;
      const m = path.match(re);
      if (!m) continue;
      const token = m[1].toLowerCase();
      const idx = path.toLowerCase().indexOf(`/${token}`);
      const slice = path.slice(
        0,
        Math.min(path.length, idx + token.length + 12),
      );
      const key = slice.replace(/\/+$/, "") || `/${token}`;
      hints.set(key, (hints.get(key) || 0) + 1);
    } catch {
      // skip
    }
  }
  return [...hints.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([pathHint, count]) => ({ pathHint, count }));
}

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} timed out after ${ms}ms`)),
        ms,
      );
    }),
  ]);
}

function sameOrigin(url, origin) {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

function looksLikePageUrl(url) {
  try {
    const u = new URL(url);
    const path = u.pathname.toLowerCase();
    if (path.endsWith(".xml") || path.includes("sitemap")) return false;
    if (path.endsWith(".pdf") || path.endsWith(".zip")) return false;
    if (path.endsWith("/all.html") || path.endsWith("all.html")) return false;
    return true;
  } catch {
    return false;
  }
}

async function collectSitemapUrls() {
  const origin = new URL(startUrl).origin;
  const raw = await discoverSitemapUrls([startUrl], [], USER_AGENT);
  const filtered = [];
  const seen = new Set();
  for (const url of raw) {
    if (!sameOrigin(url, origin)) continue;
    if (!looksLikePageUrl(url)) continue;
    const keyUrl = url.split("#")[0];
    if (seen.has(keyUrl)) continue;
    seen.add(keyUrl);
    filtered.push(keyUrl);
    if (filtered.length >= maxPages) break;
  }
  const startKey = startUrl.split("#")[0].replace(/\/+$/, "");
  if (!filtered.some((u) => u.replace(/\/+$/, "") === startKey)) {
    filtered.unshift(startUrl.split("#")[0]);
  }
  return {
    urls: filtered.slice(0, maxPages),
    sitemapTotal: raw.length,
    sameOriginKept: filtered.length,
  };
}

async function collectCrawlUrls() {
  const discovered = await discoverUrls({
    startUrls: [startUrl],
    includePatterns: [],
    excludePatterns: ["/all.html", "all.html"],
    excludeDownloadPatterns: [],
    patternsAreRegex: false,
    renderJs: false,
    useProxy: false,
    enableSitemap: true,
    sitemapOnly: false,
    sitemapUrls: [],
    fileTypes: ["html"],
    contentSelectors: [],
    excludeSelectors: [],
    maxPages,
    userAgent: USER_AGENT,
  });
  return {
    urls: (discovered.urls || []).map((row) => row.url).filter(Boolean),
    skipped: discovered.skipped?.length || 0,
  };
}

const { key, source } = resolveDeepseekKey();
if (!key) {
  console.error("No DEEPSEEK_API_KEY found in monorepo-root .env");
  process.exit(1);
}

let modelId = modelFlag ? String(modelFlag) : DEFAULT_DEEPSEEK_MODEL;
if (modelId.startsWith("deepseek/")) modelId = modelId.slice("deepseek/".length);

const openai = createOpenAI({
  apiKey: key,
  baseURL: DEEPSEEK_BASE_URL,
  name: "deepseek",
});
const model = openai.chat(modelId);

console.log(`Start URL:  ${startUrl}`);
console.log(`Model:      ${modelId} (${source})`);
console.log(`Mode:       ${useCrawl ? "crawl (+ sitemap)" : "sitemap-only"}`);
console.log(`Max URLs:   ${maxPages}`);
console.log(
  `Browser:    ${useBrowser ? (headed ? "headed" : "headless") : "off"}`,
);
console.log(`Output:     ${outPath}`);
console.log("");

let allUrls = [];
let discoveryMeta = { mode: "sitemap-only" };

if (useCrawl) {
  console.log("Discovering URLs (HTML crawl + sitemap)…");
  try {
    const crawled = await withTimeout(
      collectCrawlUrls(),
      DISCOVER_TIMEOUT_MS,
      "Crawl discovery",
    );
    allUrls = crawled.urls;
    discoveryMeta = { mode: "crawl", skipped: crawled.skipped };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`  crawl failed (${message}); falling back to sitemap-only…`);
    const sitemap = await withTimeout(
      collectSitemapUrls(),
      DISCOVER_TIMEOUT_MS,
      "Sitemap discovery",
    );
    allUrls = sitemap.urls;
    discoveryMeta = {
      mode: "sitemap-only-fallback",
      sitemapTotal: sitemap.sitemapTotal,
      sameOriginKept: sitemap.sameOriginKept,
    };
  }
} else {
  console.log("Discovering URLs (sitemap only — no HTML crawl)…");
  const sitemap = await withTimeout(
    collectSitemapUrls(),
    DISCOVER_TIMEOUT_MS,
    "Sitemap discovery",
  );
  allUrls = sitemap.urls;
  discoveryMeta = {
    mode: "sitemap-only",
    sitemapTotal: sitemap.sitemapTotal,
    sameOriginKept: sitemap.sameOriginKept,
  };
}

const clusters = pathPrefixClusters(allUrls);
const hints = suspiciousPathHints(allUrls);

console.log(
  `  discovered ${allUrls.length} URLs` +
    (discoveryMeta.sitemapTotal != null
      ? ` (sitemap raw ${discoveryMeta.sitemapTotal}, same-origin page URLs ${discoveryMeta.sameOriginKept})`
      : discoveryMeta.skipped != null
        ? ` (skipped ${discoveryMeta.skipped})`
        : ""),
);
console.log(`  path clusters: ${clusters.length}`);
console.log(`  suspicious path hints: ${hints.length}`);
console.log("");

/** @type {null | z.infer<typeof resultSchema>} */
let submitted = null;

/** @type {any} */
let stagehand = null;
if (useBrowser) {
  const { Stagehand } = loadFromCandidates(
    "@browserbasehq/stagehand",
    resolveRoots,
  );
  stagehand = new Stagehand({
    env: "LOCAL",
    model: {
      modelName: `openai/${modelId}`,
      apiKey: key,
      baseURL: DEEPSEEK_BASE_URL,
    },
    localBrowserLaunchOptions: { headless: !headed },
    verbose: 0,
  });
  await stagehand.init();
}

try {
  const tools = {
    get_url_summary: tool({
      description:
        "Return a compact summary of discovered sitemap/crawl URLs: counts, path-prefix clusters, and suspicious parallel-tree hints.",
      inputSchema: z.object({}),
      execute: async () => ({
        startUrl,
        discoveryMode: discoveryMeta.mode,
        totalUrls: allUrls.length,
        sampleUrls: allUrls.slice(0, 40),
        pathPrefixClusters: clusters,
        suspiciousPathHints: hints,
      }),
    }),

    list_urls_matching: tool({
      description:
        "List discovered URLs that contain a given path/substring (case-insensitive). Use to inspect a candidate exclude tree.",
      inputSchema: z.object({
        contains: z.string().min(1),
        limit: z.number().int().min(1).max(60).optional(),
      }),
      execute: async ({ contains, limit }) => {
        const needle = contains.toLowerCase();
        const matches = allUrls.filter((u) =>
          u.toLowerCase().includes(needle),
        );
        return {
          contains,
          matchCount: matches.length,
          sample: matches.slice(0, limit ?? 25),
        };
      },
    }),

    preview_excludes: tool({
      description:
        "Dry-run excludePatterns against the discovered list. Returns kept/dropped counts and samples.",
      inputSchema: z.object({
        excludePatterns: z.array(z.string()).max(40),
        patternsAreRegex: z.boolean(),
      }),
      execute: async ({ excludePatterns, patternsAreRegex }) => {
        const kept = [];
        const dropped = [];
        for (const url of allUrls) {
          if (matchesExclude(url, excludePatterns, patternsAreRegex)) {
            dropped.push(url);
          } else {
            kept.push(url);
          }
        }
        return {
          keptCount: kept.length,
          droppedCount: dropped.length,
          keptSample: kept.slice(0, 15),
          droppedSample: dropped.slice(0, 15),
        };
      },
    }),

    ...(useBrowser
      ? {
          stagehand_inspect_nav: tool({
            description:
              "Open the start docs page in a browser and extract version/locale/alternate-docs navigation hints.",
            inputSchema: z.object({
              url: z.string().url().optional(),
            }),
            execute: async ({ url }) => {
              try {
                const target = url || startUrl;
                const page =
                  stagehand.context.pages()[0] ||
                  (await stagehand.context.newPage());
                await page.goto(target, { waitUntil: "domcontentloaded" });
                const extracted = await stagehand.extract(
                  `Inspect this documentation page for navigation that points to alternate documentation trees a crawler might follow but a product usually should NOT index as the primary docs set.
Look for version switchers, preview/canary/nightly/beta channels, archived releases, locale variants, or other parallel doc trees.
Return currentUrl, title, alternateTreeHints, notes.`,
                  z.object({
                    currentUrl: z.string(),
                    title: z.string(),
                    alternateTreeHints: z.array(z.string()).max(20),
                    notes: z.string(),
                  }),
                );
                return extracted;
              } catch (error) {
                return {
                  error:
                    error instanceof Error ? error.message : String(error),
                };
              }
            },
          }),
        }
      : {}),

    submit_exclude_patterns: tool({
      description:
        "Submit the final excludePatterns decision. Call exactly once when ready.",
      inputSchema: resultSchema,
      execute: async (input) => {
        const dropped = allUrls.filter((u) =>
          matchesExclude(u, input.excludePatterns, input.patternsAreRegex),
        );
        if (
          allUrls.length > 0 &&
          dropped.length === allUrls.length &&
          input.excludePatterns.length > 0
        ) {
          return {
            accepted: false,
            error:
              "Patterns would exclude ALL discovered URLs. Narrow them and resubmit.",
          };
        }
        submitted = input;
        return {
          accepted: true,
          droppedCount: dropped.length,
          keptCount: allUrls.length - dropped.length,
        };
      },
    }),
  };

  await generateText({
    model,
    tools,
    toolChoice: "auto",
    stopWhen: [hasToolCall("submit_exclude_patterns"), stepCountIs(maxSteps)],
    system: `You propose LedgeIndex crawl excludePatterns for a documentation start URL.

You are given a ${useCrawl ? "crawl/sitemap" : "sitemap-only"} URL list for this docs origin. Prefer evidence from path clusters and suspicious version/channel hints.

Goal: keep the current, primary documentation tree. Exclude parallel trees a crawler would pick up that are not the latest/primary docs set.

Typical unwanted trees (detect from evidence — do not invent):
- Alternate release channels or unpublished/future doc channels (next/canary/beta/preview)
- Archived / legacy / old major-version trees when a current tree exists
- Locale mirrors you do not want (only if clearly parallel and redundant)
- Other mirrored copies of the same content that inflate the crawl

Rules:
1. Start with get_url_summary. Use list_urls_matching and preview_excludes before submitting.
2. Prefer compact path substrings that match LedgeIndex excludePatterns (substring includes unless patternsAreRegex=true).
3. Do not exclude the primary current docs tree that contains the start URL.
4. If nothing should be excluded, submit excludePatterns: [] with a short notes explanation.
5. Always set versions. Use ["latest"] when only the primary/current docs tree exists. Add other labels only when parallel version trees are clearly present.
6. Call submit_exclude_patterns exactly once when done.
7. Keep notes short.
8. ${useBrowser ? "Browser nav inspection is optional." : "No browser is available — decide from the sitemap URL list only."}`,
    prompt: `Start docs URL: ${startUrl}
Discovery mode: ${discoveryMeta.mode}
Discovered URL count: ${allUrls.length}

Inspect the URL list, propose excludePatterns + versions, preview excludes, then submit.`,
  });
} finally {
  if (stagehand) {
    try {
      await stagehand.close();
    } catch {
      // ignore
    }
  }
}

if (!submitted) {
  submitted = {
    excludePatterns: [],
    patternsAreRegex: false,
    versions: ["latest"],
    confidence: 0.2,
    notes: "Agent finished without submit_exclude_patterns",
    keepExamples: allUrls.slice(0, 5),
    dropExamples: [],
  };
}

const keptUrls = [];
const droppedUrls = [];
for (const url of allUrls) {
  if (
    matchesExclude(
      url,
      submitted.excludePatterns,
      submitted.patternsAreRegex,
    )
  ) {
    droppedUrls.push(url);
  } else {
    keptUrls.push(url);
  }
}

const payload = {
  startUrl,
  modelId,
  discoveryMode: discoveryMeta.mode,
  discoveredCount: allUrls.length,
  excludePatterns: submitted.excludePatterns,
  patternsAreRegex: submitted.patternsAreRegex,
  versions:
    Array.isArray(submitted.versions) && submitted.versions.length > 0
      ? submitted.versions
      : ["latest"],
  confidence: submitted.confidence,
  notes: submitted.notes,
  keepExamples: submitted.keepExamples || keptUrls.slice(0, 8),
  dropExamples: submitted.dropExamples || droppedUrls.slice(0, 8),
  keptCount: keptUrls.length,
  droppedCount: droppedUrls.length,
  keptUrls,
  droppedUrls,
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`);

const patternsOnlyPath = outPath.replace(/\.json$/i, ".patterns.json");
writeFileSync(
  patternsOnlyPath,
  `${JSON.stringify(
    {
      startUrl,
      excludePatterns: payload.excludePatterns,
      patternsAreRegex: payload.patternsAreRegex,
      versions: payload.versions,
      confidence: payload.confidence,
      notes: payload.notes,
      discoveryMode: payload.discoveryMode,
    },
    null,
    2,
  )}\n`,
);

console.log("Result:");
console.log(
  JSON.stringify(
    {
      discoveryMode: payload.discoveryMode,
      excludePatterns: payload.excludePatterns,
      patternsAreRegex: payload.patternsAreRegex,
      versions: payload.versions,
      confidence: payload.confidence,
      notes: payload.notes,
      keptCount: payload.keptCount,
      droppedCount: payload.droppedCount,
      dropExamples: payload.dropExamples,
      keepExamples: payload.keepExamples,
    },
    null,
    2,
  ),
);
console.log("");
console.log(`Wrote full → ${outPath}`);
console.log(`Wrote patterns → ${patternsOnlyPath}`);
