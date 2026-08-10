#!/usr/bin/env node
/**
 * Verify / fix docs URLs — fast path.
 *
 * Per package:
 *   1. Prefetch sitemap (+ light LedgeIndex crawl if sitemap is weak)
 *   2. One agent turn with that context
 *   3. Optional browser confirm (goto + DOM only — no Stagehand LLM extract/observe loops)
 *   4. submit_verified_docs
 *
 * Usage (from ledgeindex/):
 *   node scripts/verify-docs-urls.mjs --package playwright
 *   node scripts/verify-docs-urls.mjs --package playwright --headed
 *   node scripts/verify-docs-urls.mjs --input ./top-typescript-docs.json --limit 5
 *   node scripts/verify-docs-urls.mjs --concurrency 5
 *   node scripts/verify-docs-urls.mjs --resume
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ledgeRoot = resolve(__dirname, "..");
const monoRoot = resolve(ledgeRoot, "..");
const require = createRequire(import.meta.url);

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
  // bare resolve from this script
  try {
    return require(moduleId);
  } catch (err) {
    errors.push(`script: ${err instanceof Error ? err.message : String(err)}`);
  }
  throw new Error(
    `Could not resolve ${moduleId}. Tried:\n  - ${errors.join("\n  - ")}\n` +
      `Install with: npm i @browserbasehq/stagehand -w ledgeindex\n` +
      `Or keep agents-content deps installed (Stagehand lives there).`,
  );
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
const { Stagehand } = loadFromCandidates(
  "@browserbasehq/stagehand",
  resolveRoots,
);

// LedgeIndex sitemap + optional light crawl.
async function loadLedgeindexCrawl() {
  const probesPath = join(ledgeRoot, "packages/core/dist/crawl/discovery-probes.js");
  const sitemapPath = join(ledgeRoot, "packages/core/dist/crawl/sitemap.js");
  const discoverPath = join(ledgeRoot, "packages/core/dist/crawl/discover.js");
  if (!existsSync(probesPath) || !existsSync(sitemapPath)) {
    throw new Error(
      "Missing @ledgeindex/core dist crawl modules. Run: npm run build -w @ledgeindex/core",
    );
  }
  const probesMod = await import(pathToFileURL(probesPath).href);
  const sitemapMod = await import(pathToFileURL(sitemapPath).href);
  const discoverMod = existsSync(discoverPath)
    ? await import(pathToFileURL(discoverPath).href)
    : null;
  return {
    probeDiscoverySignals: probesMod.probeDiscoverySignals,
    discoverSitemapUrls: sitemapMod.discoverSitemapUrls,
    discoverUrls: discoverMod?.discoverUrls ?? null,
  };
}

const { probeDiscoverySignals, discoverSitemapUrls, discoverUrls } =
  await loadLedgeindexCrawl();

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
const outPath = resolve(
  process.cwd(),
  String(argValue("--out", inputPath)),
);
const checkpointPath = resolve(
  process.cwd(),
  String(
    argValue(
      "--checkpoint",
      resolve(ledgeRoot, ".cache/docs-verify-checkpoint.json"),
    ),
  ),
);
const baseURL = String(
  argValue("--base-url", process.env.LM_STUDIO_BASE_URL || "http://127.0.0.1:1234/v1"),
).replace(/\/$/, "");
const modelFlag = argValue("--model", null);
const resume = args.includes("--resume");
const headed = args.includes("--headed") || !args.includes("--headless");
const stagehandEnv = String(
  argValue("--env", process.env.STAGEHAND_ENV || "LOCAL"),
).toUpperCase();
const limitRaw = argValue("--limit", null);
const limit = limitRaw == null ? null : Math.max(1, Number(limitRaw) || 1);
// Confirm + submit is enough; keep a tiny buffer.
const maxSteps = Math.max(2, Number(argValue("--max-steps", 3)) || 3);
const forceCrawl = args.includes("--crawl");
const noBrowser = args.includes("--no-browser");
const concurrency = Math.min(
  12,
  Math.max(1, Number(argValue("--concurrency", 5)) || 5),
);
const crawlMaxPages = Math.min(
  80,
  Math.max(5, Number(argValue("--crawl-max-pages", 12)) || 12),
);
/** Hard cap so one slow site cannot stall a whole concurrency batch. */
const crawlTimeoutMs = Math.min(
  180_000,
  Math.max(15_000, Number(argValue("--crawl-timeout-ms", 45_000)) || 45_000),
);
const sitemapTimeoutMs = Math.min(
  180_000,
  Math.max(10_000, Number(argValue("--sitemap-timeout-ms", 30_000)) || 30_000),
);

const USER_AGENT =
  "Mozilla/5.0 (compatible; LedgeIndexDocsVerifier/0.1; +https://ledgeindex.dev)";

function withTimeout(promise, ms, label) {
  let timer = null;
  return Promise.race([
    Promise.resolve(promise).finally(() => {
      if (timer) clearTimeout(timer);
    }),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`));
      }, ms);
    }),
  ]);
}

const resultSchema = z.object({
  status: z
    .enum(["verified", "fixed", "rejected", "uncertain"])
    .describe(
      "verified=input already good docs; fixed=found better docs URL; rejected=no usable docs; uncertain=needs human",
    ),
  docsUrl: z
    .string()
    .nullable()
    .describe("Best documentation entry / learn guides URL (never github.com repo pages)"),
  apiReferenceUrls: z
    .array(z.string().url())
    .max(5)
    .optional()
    .describe(
      "Optional API reference / reference docs URLs if separate from the main docs/guides entry (e.g. react.dev/reference/react). Empty/omit if none.",
    ),
  isWeak: z
    .boolean()
    .describe(
      "true if the provided sitemap (or crawl) context is insufficient to confidently pick docs/API URLs — request more discovery. false when docsUrl decision is solid.",
    ),
  confidence: z.number().min(0).max(1),
  reason: z.string().max(400),
  pageKind: z
    .enum([
      "docs",
      "marketing_root",
      "github_readme",
      "api_reference",
      "blog",
      "unknown",
    ])
    .describe("What the starting URL looked like"),
});

const DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-flash";
const provider = String(argValue("--provider", "deepseek")).toLowerCase();
const packageFilter = argValue("--package", null);

function isGithubRepoUrl(input) {
  if (!input) return false;
  try {
    const host = new URL(input).hostname.replace(/^www\./, "").toLowerCase();
    if (host.endsWith(".github.io")) return false;
    return (
      host === "github.com" ||
      host === "githubusercontent.com" ||
      host.endsWith(".githubusercontent.com")
    );
  } catch {
    return false;
  }
}

/** Hosts we cannot use as LedgeIndex crawl docs roots. */
function isUncrawlableDocsHost(input) {
  if (!input) return false;
  if (isGithubRepoUrl(input)) return true;
  try {
    const host = new URL(input).hostname.replace(/^www\./, "").toLowerCase();
    if (
      host === "npmjs.com" ||
      host === "npmjs.org" ||
      host === "registry.npmjs.org"
    ) {
      return true;
    }
    if (host === "yarnpkg.com" || host === "npmmirror.com") return true;
    if (
      host === "twitter.com" ||
      host === "x.com" ||
      host === "linkedin.com" ||
      host.endsWith(".linkedin.com")
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

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

/**
 * Follow HTTP redirects and check whether the final URL is crawlable docs.
 * Catches decoys like https://jiti.unjs.io → https://github.com/unjs/jiti
 */
async function resolveFinalUrl(url, timeoutMs = 15_000) {
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
      redirected: requested !== finalUrl,
      uncrawlable: isUncrawlableDocsHost(finalUrl),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      requestedUrl: requested,
      finalUrl: requested,
      redirected: false,
      uncrawlable: isUncrawlableDocsHost(requested),
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function screenDocsUrl(url) {
  const normalized = normalizeUrl(url);
  if (!normalized) {
    return {
      ok: false,
      docsUrl: null,
      reason: "Invalid docs URL",
    };
  }
  if (isUncrawlableDocsHost(normalized)) {
    return {
      ok: false,
      docsUrl: null,
      reason: `docsUrl is uncrawlable host: ${normalized}`,
      probe: null,
    };
  }
  const probe = await resolveFinalUrl(normalized);
  if (probe.uncrawlable) {
    return {
      ok: false,
      docsUrl: null,
      reason: `docsUrl redirects to uncrawlable host: ${probe.finalUrl}`,
      probe,
    };
  }
  return {
    ok: true,
    docsUrl: probe.finalUrl || normalized,
    reason: null,
    probe,
  };
}

function progressLine(done, total, pkg, status, docsUrl) {
  const width = 24;
  const filled = Math.round((done / Math.max(total, 1)) * width);
  const bar = `${"█".repeat(filled)}${"░".repeat(Math.max(0, width - filled))}`;
  const pct = String(Math.round((done / Math.max(total, 1)) * 100)).padStart(3);
  const short = docsUrl ? String(docsUrl).slice(0, 48) : "-";
  return `[${bar}] ${pct}%  ${String(done).padStart(4)}/${total}  ${pkg} → ${status}  ${short}`;
}

async function listModels() {
  const res = await fetch(`${baseURL}/models`, {
    headers: { Authorization: "Bearer lm-studio" },
  });
  if (!res.ok) {
    throw new Error(
      `Cannot reach LM Studio at ${baseURL} (${res.status}). Start local server + load a model.`,
    );
  }
  const data = await res.json();
  const ids = (data.data || []).map((m) => m.id).filter(Boolean);
  if (ids.length === 0) {
    throw new Error("LM Studio returned no models. Load one first.");
  }
  return ids;
}

function loadCheckpoint() {
  if (!resume || !existsSync(checkpointPath)) {
    return { results: {}, updatedAt: null };
  }
  try {
    return JSON.parse(readFileSync(checkpointPath, "utf8"));
  } catch {
    return { results: {}, updatedAt: null };
  }
}

function saveCheckpoint(state) {
  mkdirSync(dirname(checkpointPath), { recursive: true });
  writeFileSync(
    checkpointPath,
    `${JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2)}\n`,
  );
}

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

function createAgentModel() {
  if (provider === "lmstudio") {
    const modelId = modelFlag ? String(modelFlag) : "local-model";
    const openai = createOpenAI({
      baseURL,
      apiKey: "lm-studio",
      name: "lm-studio",
    });
    return {
      model: openai.chat(modelId),
      modelId,
      label: `LM Studio ${baseURL}`,
      stagehandModelConfig: {
        modelName: modelId,
        apiKey: "lm-studio",
        baseURL,
      },
    };
  }

  const { key, source } = resolveDeepseekKey();
  if (!key) {
    console.error(`No DEEPSEEK_API_KEY found in monorepo-root .env`);
    process.exit(1);
  }
  let modelId = modelFlag ? String(modelFlag) : DEFAULT_DEEPSEEK_MODEL;
  if (modelId.startsWith("deepseek/")) modelId = modelId.slice("deepseek/".length);

  const openai = createOpenAI({
    apiKey: key,
    baseURL: DEEPSEEK_BASE_URL,
    name: "deepseek",
  });
  return {
    model: openai.chat(modelId),
    modelId,
    label: `DeepSeek ${DEEPSEEK_BASE_URL} (${source})`,
    // Stagehand expects provider/model (openai/... works with custom baseURL).
    stagehandModelConfig: {
      modelName: `openai/${modelId}`,
      apiKey: key,
      baseURL: DEEPSEEK_BASE_URL,
    },
  };
}

function createStagehand(stagehandModelConfig) {
  if (stagehandEnv === "BROWSERBASE") {
    return new Stagehand({
      env: "BROWSERBASE",
      apiKey: process.env.BROWSERBASE_API_KEY,
      projectId: process.env.BROWSERBASE_PROJECT_ID,
      model: stagehandModelConfig,
      verbose: 0,
    });
  }

  return new Stagehand({
    env: "LOCAL",
    model: stagehandModelConfig,
    localBrowserLaunchOptions: {
      headless: !headed, // false => visible Chromium window
    },
    verbose: 0,
  });
}

/** Sitemap only — no crawl heuristic. Crawl happens only if the agent sets isWeak. */
async function fetchSitemapContext(startUrl) {
  const origin = new URL(startUrl).origin;
  try {
    return await withTimeout(
      (async () => {
        const signals = await probeDiscoverySignals(startUrl, USER_AGENT);
        let sitemapUrls = [];
        if (signals.sitemap?.found) {
          sitemapUrls =
            (await discoverSitemapUrls([startUrl], [], USER_AGENT)) || [];
        }
        return {
          phase: "sitemap",
          origin,
          robotsFound: Boolean(signals.robots?.found),
          sitemapFound: Boolean(signals.sitemap?.found),
          sitemapPageCount: sitemapUrls.length || signals.sitemap?.pageCount || 0,
          sitemapSample: sitemapUrls.slice(0, 80),
          startUrl,
        };
      })(),
      sitemapTimeoutMs,
      "sitemap",
    );
  } catch (error) {
    return {
      phase: "sitemap",
      origin,
      robotsFound: false,
      sitemapFound: false,
      sitemapPageCount: 0,
      sitemapSample: [],
      startUrl,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function fetchCrawlContext(startUrl) {
  if (!discoverUrls) {
    return {
      phase: "crawl",
      crawlUsed: false,
      crawlPageCount: 0,
      crawlSample: [],
      error: "discoverUrls unavailable",
    };
  }
  try {
    const discovered = await withTimeout(
      discoverUrls({
        startUrls: [startUrl],
        includePatterns: [],
        excludePatterns: [],
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
        maxPages: crawlMaxPages,
        userAgent: USER_AGENT,
      }),
      crawlTimeoutMs,
      "crawl",
    );
    const crawlUrls = (discovered.urls || [])
      .map((row) => row.url)
      .filter(Boolean);
    return {
      phase: "crawl",
      crawlUsed: true,
      crawlPageCount: crawlUrls.length,
      crawlSample: crawlUrls.slice(0, 80),
      startUrl,
    };
  } catch (error) {
    return {
      phase: "crawl",
      crawlUsed: false,
      crawlPageCount: 0,
      crawlSample: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function buildTools({ getStagehand, packageName, allowWeak }) {
  /** @type {null | z.infer<typeof resultSchema>} */
  let submitted = null;

  const tools = {
    confirm_page: tool({
      description:
        "Optional: open one candidate URL in the browser and return title/h1/nav links via DOM (no LLM observe/extract). Use at most once to confirm the chosen docs entry.",
      inputSchema: z.object({
        url: z.string().url(),
      }),
      execute: async ({ url }) => {
        if (noBrowser) {
          return { skipped: true, reason: "--no-browser" };
        }
        try {
          const stagehand = await getStagehand();
          const page =
            stagehand.context.pages()[0] ||
            (await stagehand.context.newPage());
          await page.goto(url, { waitUntil: "domcontentloaded" });
          const currentUrl = page.url();
          const snapshot = await page.evaluate(() => {
            const links = [...document.querySelectorAll("a[href]")]
              .slice(0, 40)
              .map((a) => ({
                text: (a.textContent || "").trim().slice(0, 80),
                href: a.href,
              }))
              .filter((row) => row.href && row.text);
            return {
              title: document.title || "",
              h1: (document.querySelector("h1")?.textContent || "")
                .trim()
                .slice(0, 160),
              links,
            };
          });
          return {
            requestedUrl: url,
            currentUrl,
            isGithubRepo: isGithubRepoUrl(currentUrl),
            ...snapshot,
          };
        } catch (error) {
          return {
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    }),

    submit_verified_docs: tool({
      description: allowWeak
        ? "Submit docsUrl + apiReferenceUrls from the sitemap. Set isWeak=true if sitemap is insufficient and a crawl is needed. Set isWeak=false when confident."
        : "Submit the final decision after crawl context. Set isWeak=false. Never submit github.com repo/readme URLs as docsUrl.",
      inputSchema: resultSchema,
      execute: async (input) => {
        let docsUrl = normalizeUrl(input.docsUrl);
        if (docsUrl) {
          const screened = await screenDocsUrl(docsUrl);
          if (!screened.ok) {
            return {
              accepted: false,
              error:
                (screened.reason || "docsUrl failed redirect screen") +
                " — pick a real docs host that does not redirect to GitHub/npm, or status=rejected.",
              probe: screened.probe || null,
            };
          }
          docsUrl = screened.docsUrl;
        }
        if (!allowWeak && input.isWeak) {
          return {
            accepted: false,
            error:
              "Crawl phase already ran — set isWeak=false and submit best docsUrl from crawl context (or rejected/uncertain).",
          };
        }
        const apiReferenceUrls = [];
        for (const raw of input.apiReferenceUrls || []) {
          const screened = await screenDocsUrl(raw);
          if (screened.ok && screened.docsUrl) {
            apiReferenceUrls.push(screened.docsUrl);
          }
        }
        submitted = {
          ...input,
          docsUrl,
          apiReferenceUrls,
          isWeak: Boolean(input.isWeak),
        };
        return {
          accepted: true,
          packageName,
          isWeak: submitted.isWeak,
          finalDocsUrl: docsUrl,
        };
      },
    }),
  };

  return {
    tools,
    getSubmitted: () => submitted,
  };
}

async function runAgentPass({
  pkg,
  entry,
  startUrl,
  context,
  getStagehand,
  allowWeak,
  passLabel,
}) {
  const { tools, getSubmitted } = buildTools({
    getStagehand,
    packageName: pkg,
    allowWeak,
  });

  await generateText({
    model,
    tools,
    toolChoice: "auto",
    stopWhen: [hasToolCall("submit_verified_docs"), stepCountIs(maxSteps)],
    temperature: 0,
    system: `You verify documentation entry URLs for TypeScript/JavaScript packages for LedgeIndex.

Phase: ${passLabel}

From the discovery context, pick:
1) docsUrl — main docs / learn / guides / intro entry
2) apiReferenceUrls — optional separate API reference URLs
3) isWeak — ${
      allowWeak
        ? "true if this sitemap context is NOT enough to confidently pick those URLs (missing/empty sitemap, only marketing pages, no docs/API candidates). false when you can pick confidently."
        : "must be false in this crawl phase — pick the best URLs from crawl samples or status=rejected/uncertain."
    }

Rules:
1. Prefer docs subdomain, /docs|/guide|/learn|/reference|/intro|/api, or *.github.io.
2. NEVER accept github.com repo/blob/tree/readme as docsUrl (github.io ok).
3. NEVER accept URLs that HTTP-redirect to GitHub/npm (e.g. marketing domains that bounce to the repo). The submit tool follows redirects and will reject those.
4. Optional: confirm_page ONCE on your chosen docsUrl.
5. Call submit_verified_docs exactly once.

Statuses: verified | fixed | rejected | uncertain`,
    prompt: `Package: ${pkg}
Description: ${entry.description || "(none)"}
Category: ${entry.category || "(none)"}
Start docs URL: ${startUrl}
Homepage: ${entry.homepage || "(none)"}
GitHub: ${entry.github || "(none)"}

Discovery context:
${JSON.stringify(context, null, 2)}

Submit docsUrl, apiReferenceUrls, and isWeak.`,
  });

  return getSubmitted();
}

if (!existsSync(inputPath)) {
  console.error(`Input not found: ${inputPath}`);
  process.exit(1);
}

const input = JSON.parse(readFileSync(inputPath, "utf8"));
if (!Array.isArray(input) || input.length === 0) {
  console.error("Input JSON must be a non-empty array.");
  process.exit(1);
}

const fullInput = input;
let entries = fullInput.filter((row) => row?.package || row?.pkg);
if (packageFilter) {
  const want = String(packageFilter).toLowerCase();
  entries = entries.filter((row) => {
    const name = String(row.package || row.pkg || "").toLowerCase();
    return name === want;
  });
  if (entries.length === 0) {
    console.error(`No package matching --package ${packageFilter}`);
    process.exit(1);
  }
}
if (limit != null) entries = entries.slice(0, limit);

const { model, modelId, label, stagehandModelConfig } = createAgentModel();

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

console.log(`Provider:    ${provider}`);
console.log(`Model:       ${modelId}`);
console.log(`Client:      ${label}`);
console.log(
  `Browser:     ${noBrowser ? "off" : `${stagehandEnv}${headed ? " (headed)" : " (headless)"}`}`,
);
console.log(`Entries:     ${entries.length}`);
console.log(`Concurrency: ${concurrency}`);
console.log(
  `Timeouts:    sitemap ${Math.round(sitemapTimeoutMs / 1000)}s · crawl ${Math.round(crawlTimeoutMs / 1000)}s (max ${crawlMaxPages} pages)`,
);
console.log(`Max steps:   ${maxSteps}`);
console.log(`Input:       ${inputPath}`);
console.log(`Output:      ${outPath}`);
console.log(`Resume:      ${resume ? "yes" : "no"}`);
console.log("");

const checkpoint = loadCheckpoint();
const results = { ...(checkpoint.results || {}) };
const started = Date.now();
let doneCount = 0;
let checkpointChain = Promise.resolve();

function saveCheckpointSafe(state) {
  checkpointChain = checkpointChain.then(() => {
    saveCheckpoint(state);
  });
  return checkpointChain;
}

async function verifyOne(entry) {
  const pkg = entry.package || entry.pkg;
  const startUrl =
    normalizeUrl(entry.docs) ||
    normalizeUrl(entry.homepage) ||
    normalizeUrl(entry.url);

  if (results[pkg]?.status) {
    return { pkg, skipped: true, row: results[pkg] };
  }

  if (!startUrl) {
    const row = {
      package: pkg,
      status: "rejected",
      docsUrl: null,
      confidence: 0,
      reason: "No docs/homepage URL on the candidate entry",
      pageKind: "unknown",
      originalDocs: entry.docs || null,
      modelId,
    };
    results[pkg] = row;
    await saveCheckpointSafe({ results });
    return { pkg, skipped: false, row };
  }

  console.log(`[${pkg}] resolve…`);
  const startProbe = await resolveFinalUrl(startUrl);
  console.log(
    `[${pkg}] resolve ${startUrl} → ${startProbe.finalUrl}` +
      (startProbe.redirected ? " (redirect)" : "") +
      (startProbe.uncrawlable ? " UNCRAWLABLE" : "") +
      (startProbe.error ? ` error=${startProbe.error}` : ""),
  );

  console.log(`[${pkg}] sitemap…`);
  const sitemapSeed =
    startProbe.uncrawlable || !startProbe.ok
      ? startUrl
      : startProbe.finalUrl || startUrl;
  const sitemapContext = {
    ...(await fetchSitemapContext(sitemapSeed)),
    redirectProbe: {
      requestedUrl: startProbe.requestedUrl,
      finalUrl: startProbe.finalUrl,
      redirected: startProbe.redirected,
      uncrawlable: startProbe.uncrawlable,
      status: startProbe.status,
      error: startProbe.error || null,
    },
  };
  console.log(
    `[${pkg}] sitemap pages=${sitemapContext.sitemapPageCount} sample=${sitemapContext.sitemapSample.length}` +
      (sitemapContext.error ? ` error=${sitemapContext.error}` : ""),
  );

  /** @type {any} */
  let stagehand = null;
  const getStagehand = async () => {
    if (noBrowser) throw new Error("Browser disabled");
    if (!stagehand) {
      stagehand = createStagehand(stagehandModelConfig);
      await stagehand.init();
    }
    return stagehand;
  };

  let submitted = null;
  try {
    submitted = await runAgentPass({
      pkg,
      entry,
      startUrl,
      context: sitemapContext,
      getStagehand,
      allowWeak: true,
      passLabel: "sitemap",
    });

    const needsCrawl =
      forceCrawl || (submitted?.isWeak === true && Boolean(discoverUrls));

    if (needsCrawl) {
      console.log(
        `[${pkg}] agent isWeak=${submitted?.isWeak === true} → crawl…`,
      );
      const crawlContext = await fetchCrawlContext(startUrl);
      console.log(
        `[${pkg}] crawl pages=${crawlContext.crawlPageCount}` +
          (crawlContext.error ? ` error=${crawlContext.error}` : ""),
      );

      submitted = await runAgentPass({
        pkg,
        entry,
        startUrl,
        context: {
          ...sitemapContext,
          ...crawlContext,
          priorSitemapDecision: submitted
            ? {
                docsUrl: submitted.docsUrl,
                apiReferenceUrls: submitted.apiReferenceUrls,
                isWeak: submitted.isWeak,
                reason: submitted.reason,
              }
            : null,
        },
        getStagehand,
        allowWeak: false,
        passLabel: "crawl",
      });
    }

    if (!submitted) {
      submitted = {
        status: "uncertain",
        docsUrl: null,
        apiReferenceUrls: [],
        isWeak: false,
        confidence: 0.2,
        reason: "Agent finished without submit_verified_docs",
        pageKind: "unknown",
      };
    } else {
      submitted = {
        ...submitted,
        isWeak: false,
        sitemapWasWeak: Boolean(needsCrawl && !forceCrawl),
      };
    }

    // Final redirect screen — never persist GitHub-bouncing decoys.
    if (submitted.docsUrl) {
      const screened = await screenDocsUrl(submitted.docsUrl);
      if (!screened.ok) {
        console.log(`[${pkg}] screen FAIL ${screened.reason}`);
        submitted = {
          ...submitted,
          status: "rejected",
          docsUrl: null,
          apiReferenceUrls: [],
          confidence: Math.min(submitted.confidence ?? 0.4, 0.4),
          reason: screened.reason || "docsUrl failed redirect screen",
          pageKind: "unknown",
        };
      } else if (screened.docsUrl !== submitted.docsUrl) {
        console.log(
          `[${pkg}] screen rewrite ${submitted.docsUrl} → ${screened.docsUrl}`,
        );
        submitted = { ...submitted, docsUrl: screened.docsUrl };
      }
    } else if (
      submitted.status === "verified" ||
      submitted.status === "fixed"
    ) {
      submitted = {
        ...submitted,
        status: "rejected",
        reason:
          submitted.reason ||
          "No crawlable docsUrl after redirect screen",
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    submitted = {
      status: "uncertain",
      docsUrl: null,
      apiReferenceUrls: [],
      isWeak: false,
      confidence: 0,
      reason: `Verifier failed: ${message.slice(0, 220)}`,
      pageKind: "unknown",
    };
  } finally {
    if (stagehand) {
      try {
        await stagehand.close();
      } catch {
        // ignore
      }
    }
  }

  const row = {
    package: pkg,
    ...submitted,
    originalDocs: entry.docs || null,
    homepage: entry.homepage || null,
    category: entry.category || null,
    description: entry.description || null,
    downloadsLastMonth: entry.downloadsLastMonth ?? null,
    github: entry.github || null,
    modelId,
  };
  results[pkg] = row;
  await saveCheckpointSafe({ results });
  return { pkg, skipped: false, row };
}

let progressChain = Promise.resolve();
function logProgress(item) {
  progressChain = progressChain.then(() => {
    doneCount += 1;
    console.log(
      progressLine(
        doneCount,
        entries.length,
        item.pkg,
        item.row.status,
        item.row.docsUrl,
      ),
    );
  });
  return progressChain;
}

for (const group of chunk(entries, concurrency)) {
  await Promise.all(
    group.map(async (entry) => {
      const item = await verifyOne(entry);
      await logProgress(item);
      return item;
    }),
  );
}

await checkpointChain;
process.stdout.write("\n");

function applyVerifiedFields(entry, row) {
  const rejected = row.status === "rejected";
  const docsUrl =
    !rejected &&
    row.docsUrl &&
    !isUncrawlableDocsHost(row.docsUrl)
      ? row.docsUrl
      : null;
  const apiReferenceUrls =
    !rejected && Array.isArray(row.apiReferenceUrls)
      ? row.apiReferenceUrls.filter(
          (u) => u && !isUncrawlableDocsHost(u),
        )
      : [];
  return {
    ...entry,
    // On reject, clear prior decoy docs so the dataset stays honest.
    docs: rejected ? null : docsUrl || entry.docs || null,
    apiReferenceUrls:
      apiReferenceUrls.length > 0
        ? apiReferenceUrls
        : rejected
          ? []
          : entry.apiReferenceUrls || [],
    docsStatus: row.status || entry.docsStatus || "uncertain",
    docsConfidence: row.confidence ?? entry.docsConfidence ?? null,
    docsReason: row.reason || entry.docsReason || null,
    pageKind: row.pageKind ?? entry.pageKind ?? null,
    modelId: row.modelId || entry.modelId || modelId,
  };
}

let output;
if (outPath === inputPath) {
  // Merge into full list so --package / --limit never wipe other rows.
  output = fullInput.map((entry) => {
    const pkg = entry.package || entry.pkg;
    const row = results[pkg];
    if (!row?.status) return entry;
    return applyVerifiedFields(entry, row);
  });
} else {
  output = entries.map((entry, idx) => {
    const pkg = entry.package || entry.pkg;
    const row = results[pkg] || {};
    return {
      rank: idx + 1,
      ...applyVerifiedFields(entry, row),
      originalDocs: entry.docs || null,
    };
  });
}

writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`);

const verifiedCount = Object.values(results).filter(
  (row) => row.status === "verified" || row.status === "fixed",
).length;
const counts = { verified: 0, fixed: 0, rejected: 0, uncertain: 0 };
const failedRows = [];
const uncertainRows = [];
const usableRows = [];
for (const row of Object.values(results)) {
  const key = row.status in counts ? row.status : "uncertain";
  counts[key] += 1;
  if (row.status === "verified" || row.status === "fixed") usableRows.push(row);
  else if (row.status === "uncertain") uncertainRows.push(row);
  else failedRows.push(row);
}

const summaryPath = resolve(ledgeRoot, ".cache/docs-verify-summary.json");
const summary = {
  generatedAt: new Date().toISOString(),
  modelId,
  processed: Object.keys(results).length,
  counts,
  usableCount: verifiedCount,
  usable: usableRows.map((r) => ({
    package: r.package,
    status: r.status,
    docsUrl: r.docsUrl,
    confidence: r.confidence,
  })),
  uncertain: uncertainRows.map((r) => ({
    package: r.package,
    docsUrl: r.docsUrl,
    reason: r.reason,
  })),
  failed: failedRows.map((r) => ({
    package: r.package,
    status: r.status,
    docsUrl: r.docsUrl,
    reason: r.reason,
  })),
};
mkdirSync(dirname(summaryPath), { recursive: true });
writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);

const elapsedSec = ((Date.now() - started) / 1000).toFixed(1);
console.log("Status counts (this run / checkpoint):");
for (const [k, v] of Object.entries(counts)) {
  console.log(`  ${k.padEnd(10)} ${v}`);
}
console.log("");
console.log(`Usable (verified+fixed): ${verifiedCount}`);
if (uncertainRows.length) {
  console.log(`Needs review (uncertain): ${uncertainRows.length}`);
  for (const row of uncertainRows.slice(0, 20)) {
    console.log(
      `  - ${row.package}: ${row.docsUrl || "-"} — ${row.reason || ""}`,
    );
  }
}
if (failedRows.length) {
  console.log(`Failed (rejected): ${failedRows.length}`);
  for (const row of failedRows.slice(0, 20)) {
    console.log(
      `  - ${row.package}: ${row.reason || "(no reason)"}`,
    );
  }
}
console.log("");
console.log(`Done in ${elapsedSec}s`);
console.log(`Wrote ${output.length} → ${outPath}`);
console.log(`Summary → ${summaryPath}`);
console.log("");
console.log(
  "Next: node scripts/discover-docs-paths.mjs --resume",
);
