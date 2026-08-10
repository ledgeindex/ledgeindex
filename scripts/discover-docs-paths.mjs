#!/usr/bin/env node
/**
 * Discover docs section paths (guides / api / examples / …) for verified packages.
 *
 * Primary strategy (browser):
 *   1. snapshot + screenshot → gate: is this a TOP horizontal section navbar?
 *   2. If no → seed only (sidebar/single-tree sites — do not invent siblings)
 *   3. If yes → observe() active tab → DOM peer links as section roots
 *
 * Fallback agent only when top-navbar was detected but observe failed.
 *
 * Usage (from ledgeindex/):
 *   node scripts/discover-docs-paths.mjs --package @modelcontextprotocol/sdk
 *   node scripts/discover-docs-paths.mjs --limit 10
 *   node scripts/discover-docs-paths.mjs --resume
 *   node scripts/discover-docs-paths.mjs --no-browser
 *
 * Env: GOOGLE_GENERATIVE_AI_API_KEY (or GOOGLE_API_KEY)
 * Default: google/gemini-3.5-flash-lite (also used by Stagehand observe)
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
  try {
    return require(moduleId);
  } catch (err) {
    errors.push(`script: ${err instanceof Error ? err.message : String(err)}`);
  }
  throw new Error(`Could not resolve ${moduleId}.\n  - ${errors.join("\n  - ")}`);
}

const resolveRoots = [
  join(ledgeRoot, "packages", "core"),
  join(ledgeRoot, "packages", "docs"),
  ledgeRoot,
  join(monoRoot, "agents-content"),
  monoRoot,
];

const { createOpenAI } = loadFromCandidates("@ai-sdk/openai", resolveRoots);
// Prefer workspace-pinned @ai-sdk/google@2.x (AI SDK 5 / spec v2).
const { createGoogleGenerativeAI } = loadFromCandidates("@ai-sdk/google", [
  join(ledgeRoot, "packages", "core"),
  join(ledgeRoot, "packages", "docs"),
  ...resolveRoots,
]);
const { generateText, tool, stepCountIs, hasToolCall } = loadFromCandidates(
  "ai",
  resolveRoots,
);
const { z } = loadFromCandidates("zod", resolveRoots);
const { Stagehand } = loadFromCandidates(
  "@browserbasehq/stagehand",
  resolveRoots,
);

async function loadLedgeindexSitemap() {
  const probesPath = join(
    ledgeRoot,
    "packages/core/dist/crawl/discovery-probes.js",
  );
  const sitemapPath = join(ledgeRoot, "packages/core/dist/crawl/sitemap.js");
  if (!existsSync(probesPath) || !existsSync(sitemapPath)) {
    throw new Error(
      "Missing @ledgeindex/core dist crawl modules. Run: npm run build -w @ledgeindex/core",
    );
  }
  const probesMod = await import(pathToFileURL(probesPath).href);
  const sitemapMod = await import(pathToFileURL(sitemapPath).href);
  return {
    probeDiscoverySignals: probesMod.probeDiscoverySignals,
    discoverSitemapUrls: sitemapMod.discoverSitemapUrls,
  };
}

const { probeDiscoverySignals, discoverSitemapUrls } =
  await loadLedgeindexSitemap();

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
const singleUrl = String(argValue("--url", "") || "").trim() || null;
const outPath = resolve(
  process.cwd(),
  String(
    argValue(
      "--out",
      // Never overwrite the main docs list for one-off --url probes.
      singleUrl
        ? resolve(ledgeRoot, ".cache/docs-paths-url-probe.json")
        : inputPath,
    ),
  ),
);
const checkpointPath = resolve(
  process.cwd(),
  String(
    argValue(
      "--checkpoint",
      resolve(ledgeRoot, ".cache/docs-paths-checkpoint.json"),
    ),
  ),
);
const summaryPath = resolve(
  process.cwd(),
  String(
    argValue(
      "--summary",
      resolve(ledgeRoot, ".cache/docs-paths-summary.json"),
    ),
  ),
);
const resume = args.includes("--resume");
const includeUncertain = args.includes("--include-uncertain");
const headed = args.includes("--headed");
const noBrowser = args.includes("--no-browser");
const useBrowser = !noBrowser;
const packageFilter = argValue("--package", null);
const limitRaw = argValue("--limit", null);
const limit = limitRaw == null ? null : Math.max(1, Number(limitRaw) || 1);
const concurrencyRaw = Math.min(
  12,
  Math.max(1, Number(argValue("--concurrency", useBrowser ? 1 : 4)) || 4),
);
// Shared Stagehand browser must not run packages in parallel.
const concurrency = useBrowser ? 1 : concurrencyRaw;
const maxSteps = Math.max(2, Number(argValue("--max-steps", 4)) || 4);
const sitemapTimeoutMs = Math.min(
  120_000,
  Math.max(10_000, Number(argValue("--sitemap-timeout-ms", 25_000)) || 25_000),
);
const htmlTimeoutMs = Math.min(
  60_000,
  Math.max(5_000, Number(argValue("--html-timeout-ms", 15_000)) || 15_000),
);
const browserTimeoutMs = Math.min(
  180_000,
  Math.max(30_000, Number(argValue("--browser-timeout-ms", 90_000)) || 90_000),
);
/** Drop path candidates below this confidence (omit > wrong). */
const minPathConfidence = Math.min(
  1,
  Math.max(0, Number(argValue("--min-confidence", 0.75)) || 0.75),
);
/** Hard cap on snapshot text sent to the model (nav is near the top). */
const snapshotMaxChars = Math.min(
  40_000,
  Math.max(2_000, Number(argValue("--snapshot-max-chars", 12_000)) || 12_000),
);
const sitemapSampleMax = Math.min(
  120,
  Math.max(20, Number(argValue("--sitemap-sample", 60)) || 60),
);
const stagehandEnv = String(
  argValue("--stagehand-env", process.env.STAGEHAND_ENV || "LOCAL"),
).toUpperCase();

const USER_AGENT =
  "Mozilla/5.0 (compatible; LedgeIndexDocsPaths/0.1; +https://ledgeindex.dev)";
const DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-flash";
const DEFAULT_GOOGLE_MODEL = "gemini-3.5-flash-lite";
const provider = String(argValue("--provider", "google")).toLowerCase();
const modelFlag = argValue("--model", null);

const PATH_KINDS = [
  "guides",
  "api",
  "examples",
  "reference",
  "home",
  "other",
];

const resultSchema = z.object({
  status: z
    .enum(["discovered", "uncertain", "failed"])
    .describe("discovered | uncertain | failed"),
  paths: z
    .array(
      z.object({
        kind: z.enum(PATH_KINDS),
        url: z.string(),
        label: z.string().optional(),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(12),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});

function truncateSnapshotTree(tree, maxChars) {
  const text = String(tree || "");
  if (text.length <= maxChars) {
    return { text, truncated: false, originalChars: text.length };
  }
  return {
    text: `${text.slice(0, maxChars)}\n…[truncated ${text.length - maxChars} chars]`,
    truncated: true,
    originalChars: text.length,
  };
}

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

function resolveGoogleKey() {
  for (const name of ["GOOGLE_GENERATIVE_AI_API_KEY", "GOOGLE_API_KEY"]) {
    const fromEnv = process.env[name]?.trim();
    if (fromEnv) return { key: fromEnv, source: `env:${name}` };
  }
  for (const root of [monoRoot, ledgeRoot]) {
    const parsed = loadEnvFile(resolve(root, ".env"));
    for (const name of ["GOOGLE_GENERATIVE_AI_API_KEY", "GOOGLE_API_KEY"]) {
      const value = parsed[name]?.trim();
      if (value) return { key: value, source: `${root}/.env (${name})` };
    }
  }
  return { key: "", source: null };
}

function normalizeGoogleModelId(raw) {
  let modelId = String(raw || DEFAULT_GOOGLE_MODEL);
  if (modelId.startsWith("google/")) modelId = modelId.slice("google/".length);
  return modelId;
}

function createAgentModel() {
  if (provider === "google" || provider === "gemini") {
    const { key, source } = resolveGoogleKey();
    if (!key) {
      throw new Error(
        "GOOGLE_GENERATIVE_AI_API_KEY (or GOOGLE_API_KEY) missing. Set it in monorepo .env.",
      );
    }
    const modelId = normalizeGoogleModelId(modelFlag || DEFAULT_GOOGLE_MODEL);
    const client = createGoogleGenerativeAI({ apiKey: key });
    return {
      model: client(modelId),
      modelId,
      label: `Google Gemini (${source})`,
      stagehandModelConfig: {
        modelName: `google/${modelId}`,
        apiKey: key,
      },
    };
  }

  if (provider === "deepseek") {
    const { key, source } = resolveDeepseekKey();
    if (!key) {
      throw new Error(
        "DEEPSEEK_API_KEY missing. Set it in monorepo .env or the environment.",
      );
    }
    const modelId = String(modelFlag || DEFAULT_DEEPSEEK_MODEL);
    const client = createOpenAI({
      apiKey: key,
      baseURL: DEEPSEEK_BASE_URL,
      name: "deepseek",
    });
    return {
      model: client.chat(modelId),
      modelId,
      label: `DeepSeek ${DEEPSEEK_BASE_URL} (${source})`,
      stagehandModelConfig: {
        modelName: `openai/${modelId}`,
        apiKey: key,
        baseURL: DEEPSEEK_BASE_URL,
      },
    };
  }

  throw new Error(`Unsupported --provider ${provider} (use google|deepseek)`);
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
      headless: !headed,
    },
    verbose: 0,
  });
}

const MARKETING_SEG_RE =
  /^(pricing|login|signin|signup|register|careers|jobs|about|contact|legal|privacy|terms|cookies|status)$/i;

function pathSegments(url) {
  try {
    return new URL(url).pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  } catch {
    return [];
  }
}

function isVersionishSeg(seg) {
  return (
    /^v\d+/i.test(seg) ||
    /^\d{4}-\d{2}-\d{2}$/.test(seg) ||
    /^latest$/i.test(seg)
  );
}

/** Site section key: docs vs specification, or v3/first-steps vs v3/basics. */
function sectionRootKey(url) {
  const segs = pathSegments(url);
  if (segs.length === 0) return "";
  if (isVersionishSeg(segs[0]) && segs.length >= 2) {
    return `${segs[0]}/${segs[1]}`.toLowerCase();
  }
  return segs[0].toLowerCase();
}

/** Parent directory path (everything except the leaf). Same value ⇒ same-folder subpages. */
function parentDirKey(url) {
  const segs = pathSegments(url);
  if (segs.length <= 1) return segs.join("/").toLowerCase();
  return segs.slice(0, -1).join("/").toLowerCase();
}

function classifyPathKind(url, label = "") {
  const text = `${label} ${url}`.toLowerCase();
  if (/example|cookbook|tutorial|demo/.test(text)) return "examples";
  if (/\/api(\/|$)|api[- ]?reference|typedoc|reference\/api/.test(text))
    return "api";
  if (/specification|\/spec(\/|$)|reference/.test(text)) return "reference";
  if (/docs?|guide|learn|getting[- ]?started|documentation|intro/.test(text))
    return "guides";
  if (/home|\/$/.test(text)) return "home";
  return "other";
}

function isMarketingNavUrl(url) {
  const segs = pathSegments(url);
  if (segs.length === 0) return false;
  return (
    MARKETING_SEG_RE.test(segs[0]) ||
    MARKETING_SEG_RE.test(segs[segs.length - 1])
  );
}

/**
 * Keep only true section siblings (different section roots).
 * Drop same-folder subpages e.g. /v3/first-steps/introduction + /v3/first-steps/quickstart.
 */
function filterSectionSiblings(siblings) {
  const bySection = new Map();
  for (const row of siblings || []) {
    const key = sectionRootKey(row.url);
    if (!key) continue;
    const prev = bySection.get(key);
    if (!prev) {
      bySection.set(key, row);
      continue;
    }
    // Prefer marked main, else shallower path.
    const prefer =
      row.isMain && !prev.isMain
        ? row
        : !row.isMain && prev.isMain
          ? prev
          : pathSegments(row.url).length < pathSegments(prev.url).length
            ? row
            : prev;
    bySection.set(key, prefer);
  }

  let out = [...bySection.values()];
  if (out.length <= 1) return out;

  // If every remaining URL shares the same parent directory, they are subpages
  // of one section — not supported as multi-root siblings for now.
  const dirs = new Set(out.map((row) => parentDirKey(row.url)));
  if (dirs.size === 1) {
    const only = out.find((row) => row.isMain) || out[0];
    return only ? [only] : [];
  }

  // Also drop any extras that still share a parentDir with another kept item
  // when they aren't distinct section keys (already unique by section).
  return out;
}

const navLayoutSchema = z.object({
  isTopNavbar: z
    .boolean()
    .describe(
      "true ONLY if there is a horizontal TOP primary nav with multiple site-section tabs (Docs|API|Spec|…)",
    ),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});

/**
 * Gate: screenshot + snapshot decide whether this is a top-navbar sibling case.
 * Sidebar-only / single-docs-tree sites must return false.
 */
async function classifyTopNavbarLayout({ model, seedUrl, snapshotText, screenshot }) {
  /** @type {any} */
  let submitted = null;
  const tools = {
    submit_nav_layout: tool({
      description: "Submit whether the page has a top horizontal section navbar.",
      inputSchema: navLayoutSchema,
      execute: async (input) => {
        submitted = input;
        return { ok: true };
      },
    }),
  };

  const text = `Seed URL: ${seedUrl}

Decide if this docs site has a HORIZONTAL TOP primary navigation bar with multiple SITE SECTION tabs
(example: Documentation | Specification | Extensions | Registry).

isTopNavbar=true ONLY when:
- There is a clear top/header tab row
- Tabs are peer site sections (different top-level areas), not nested pages of one docs tree

isTopNavbar=false when:
- Nav is mainly a LEFT SIDEBAR / TOC (like many Mintlify/Nextra single-docs sites, e.g. zod.dev)
- Only one docs section with nested articles
- Marketing header links only (GitHub, Discord) without section siblings
- Ambiguous — prefer false

=== page.snapshot() (capped) ===
${snapshotText || "(empty)"}

${screenshot?.ok ? "Viewport screenshot attached." : "No screenshot available."}

Call submit_nav_layout once.`;

  const content =
    screenshot?.ok && screenshot.buffer
      ? [
          { type: "text", text },
          {
            type: "image",
            image: screenshot.buffer,
            mediaType: "image/png",
          },
        ]
      : text;

  try {
    await generateText({
      model,
      tools,
      toolChoice: "auto",
      stopWhen: [stepCountIs(3), hasToolCall("submit_nav_layout")],
      system:
        "You classify docs-site navigation layout. Be strict: sidebar-only = not top navbar.",
      ...(typeof content === "string"
        ? { prompt: content }
        : { messages: [{ role: "user", content }] }),
    });
  } catch (error) {
    return {
      isTopNavbar: false,
      confidence: 0,
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  if (!submitted) {
    return {
      isTopNavbar: false,
      confidence: 0,
      reason: "No nav layout submit",
    };
  }
  return {
    isTopNavbar: Boolean(submitted.isTopNavbar),
    confidence: Number(submitted.confidence) || 0,
    reason: String(submitted.reason || ""),
  };
}

/**
 * Browser discovery:
 * 1) snapshot + screenshot → is this a top-navbar case?
 * 2) if yes → observe active tab → DOM siblings
 * 3) if no → seed only (do not invent sidebar "siblings")
 */
async function discoverPathsViaBrowser(stagehand, seedUrl, model) {
  try {
    return await withTimeout(
      (async () => {
        const page =
          stagehand.context.pages()[0] ||
          (await stagehand.context.newPage());
        await page.goto(seedUrl, { waitUntil: "domcontentloaded" });
        try {
          await page.waitForTimeout(1200);
        } catch {
          // optional settle
        }

        const snap = await page.snapshot();
        const rawTree = String(snap?.formattedTree || "");
        const capped = truncateSnapshotTree(rawTree, snapshotMaxChars);

        let screenshot = { ok: false, buffer: null, error: null };
        try {
          const buffer = await page.screenshot({
            type: "png",
            fullPage: false,
          });
          screenshot = {
            ok: Buffer.isBuffer(buffer) && buffer.length > 0,
            buffer,
            error: null,
          };
        } catch (error) {
          screenshot = {
            ok: false,
            buffer: null,
            error: error instanceof Error ? error.message : String(error),
          };
        }

        const layout = await classifyTopNavbarLayout({
          model,
          seedUrl,
          snapshotText: capped.text,
          screenshot,
        });

        if (!layout.isTopNavbar) {
          return {
            ok: true,
            mode: "seed-only",
            isTopNavbar: false,
            layout,
            siblings: [],
            finalUrl: page.url(),
            error: null,
          };
        }

        const instruction =
          "find the active/current primary HEADER/TOP navigation tab for Documentation, Docs, Guide, or Learn — not a sidebar link";
        const observed = await stagehand.observe(instruction);
        const first = Array.isArray(observed) ? observed[0] : observed;
        const selector = first?.selector || null;
        if (!selector) {
          return {
            ok: false,
            mode: "observe",
            isTopNavbar: true,
            layout,
            siblings: [],
            finalUrl: page.url(),
            observe: observed,
            error: "observe() returned no selector",
          };
        }

        const extracted = await page.evaluate((sel) => {
          function abs(href) {
            try {
              const u = new URL(href, location.href);
              u.hash = "";
              return u.toString().replace(/\/$/, "") || u.origin;
            } catch {
              return null;
            }
          }
          function firstSeg(url) {
            try {
              return new URL(url).pathname.split("/").filter(Boolean)[0] || "";
            } catch {
              return "";
            }
          }
          function isVersionish(seg) {
            return (
              /^v\d+/i.test(seg) ||
              /^\d{4}-\d{2}-\d{2}$/.test(seg) ||
              /^latest$/i.test(seg)
            );
          }
          function sectionKey(url) {
            const segs = new URL(url).pathname
              .replace(/\/+$/, "")
              .split("/")
              .filter(Boolean);
            if (!segs.length) return "";
            if (isVersionish(segs[0]) && segs.length >= 2) {
              return `${segs[0]}/${segs[1]}`.toLowerCase();
            }
            return segs[0].toLowerCase();
          }

          let el = null;
          try {
            if (
              String(sel).startsWith("xpath=") ||
              String(sel).startsWith("/")
            ) {
              const xp = String(sel).replace(/^xpath=/i, "");
              el = document.evaluate(
                xp,
                document,
                null,
                XPathResult.FIRST_ORDERED_NODE_TYPE,
                null,
              ).singleNodeValue;
            } else {
              el = document.querySelector(sel);
            }
          } catch (error) {
            return {
              ok: false,
              error: `selector resolve failed: ${error.message}`,
              selector: sel,
            };
          }
          if (!el) {
            return { ok: false, error: "element not found", selector: sel };
          }

          const link =
            el.closest?.("a[href]") ||
            (el.tagName === "A" ? el : el.querySelector?.("a[href]"));
          const target = link || el;

          // Walk up: observe often hits an inner wrapper that only contains
          // the active tab. Keep climbing until peer links span 2+ sections.
          let best = null;
          let node = target;
          for (let depth = 0; depth < 8 && node; depth += 1) {
            const parent = node.parentElement;
            if (!parent) break;
            const peers = [...parent.children]
              .map((child) => {
                const a =
                  child.tagName === "A"
                    ? child
                    : child.querySelector?.(":scope > a[href], a[href]");
                if (!a) return null;
                const href = abs(a.getAttribute("href"));
                if (!href) return null;
                // Prefer shallow header links (skip deep nested sidebar).
                if (a.closest("aside, [data-sidebar], nav[aria-label*='sidebar' i]")) {
                  return null;
                }
                return {
                  text: (a.textContent || "")
                    .trim()
                    .replace(/\s+/g, " ")
                    .slice(0, 80),
                  href,
                  seg: firstSeg(href),
                  section: sectionKey(href),
                  isMain:
                    child === target ||
                    a === target ||
                    child.contains?.(target) ||
                    false,
                };
              })
              .filter(Boolean);

            const sectionCount = new Set(
              peers.map((p) => p.section).filter(Boolean),
            ).size;
            if (
              !best ||
              sectionCount > best.sectionCount ||
              (sectionCount === best.sectionCount &&
                peers.length > best.siblings.length)
            ) {
              best = {
                ok: peers.length > 0,
                selector: sel,
                depth,
                sectionCount,
                parentTag: parent.tagName.toLowerCase(),
                parentClass: String(parent.className || "").slice(0, 120),
                siblings: peers,
              };
            }
            if (sectionCount >= 2) break;
            node = parent;
          }

          return (
            best || {
              ok: false,
              error: "no parent peers",
              selector: sel,
            }
          );
        }, selector);

        if (!extracted?.ok) {
          return {
            ok: false,
            mode: "observe",
            isTopNavbar: true,
            layout,
            siblings: [],
            finalUrl: page.url(),
            observe: first,
            error: extracted?.error || "no siblings from parent",
          };
        }

        const origin = new URL(seedUrl).origin;
        const rawSiblings = (extracted.siblings || [])
          .map((row) => {
            const url = normalizeUrl(row.href);
            if (!url || isGithubRepoUrl(url)) return null;
            try {
              if (new URL(url).origin !== origin) return null;
            } catch {
              return null;
            }
            if (isMarketingNavUrl(url)) return null;
            return {
              text: row.text,
              url,
              seg: sectionRootKey(url),
              isMain: Boolean(row.isMain),
              kind: classifyPathKind(url, row.text),
            };
          })
          .filter(Boolean);

        const siblings = filterSectionSiblings(rawSiblings);
        const droppedSamePath = rawSiblings.length - siblings.length;

        return {
          ok: siblings.length > 0,
          mode: "observe",
          isTopNavbar: true,
          layout,
          siblings,
          rawSiblingCount: rawSiblings.length,
          droppedSamePath,
          finalUrl: page.url(),
          observe: {
            description: first?.description || null,
            selector,
            parentTag: extracted.parentTag,
            parentClass: extracted.parentClass,
          },
          error: siblings.length
            ? null
            : droppedSamePath > 0
              ? "nav peers were same-path subpages (not section siblings)"
              : "siblings filtered to empty",
        };
      })(),
      browserTimeoutMs,
      "topnav-gate+observe",
    );
  } catch (error) {
    return {
      ok: false,
      mode: "error",
      isTopNavbar: false,
      layout: null,
      siblings: [],
      finalUrl: seedUrl,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function siblingsToSubmitted(siblings, seedUrl) {
  const sectionSiblings = filterSectionSiblings(siblings || []);
  // Need at least 2 distinct section roots to count as sibling discovery.
  // A single same-path cluster is not supported yet.
  if (sectionSiblings.length < 2) {
    return {
      status: "uncertain",
      paths: filterConfidentPaths([
        {
          kind: "guides",
          url: seedUrl,
          label: "docs",
          confidence: minPathConfidence,
        },
      ]),
      confidence: 0.45,
      reason:
        sectionSiblings.length === 1
          ? "observe found only one section root (no cross-section siblings); kept seed"
          : "observe peers were same-path subpages; kept seed only",
    };
  }

  const paths = filterConfidentPaths(
    sectionSiblings.map((row) => ({
      kind: row.kind || classifyPathKind(row.url, row.text),
      url: row.url,
      label: row.text || undefined,
      confidence: 0.95,
    })),
  );
  return {
    status: "discovered",
    paths,
    confidence: 0.95,
    reason: `observe() primary-nav section siblings (${paths.length})`,
  };
}

function filterConfidentPaths(paths) {
  const out = [];
  const seen = new Set();
  for (const row of paths || []) {
    const url = normalizeUrl(row.url);
    if (!url || isGithubRepoUrl(url) || seen.has(url)) continue;
    const confidence =
      typeof row.confidence === "number" ? row.confidence : null;
    // Missing confidence → treat as weak and drop (omit > wrong).
    if (confidence == null || confidence < minPathConfidence) continue;
    seen.add(url);
    out.push({
      kind: row.kind,
      url,
      confidence,
      ...(row.label ? { label: String(row.label).slice(0, 80) } : {}),
    });
  }
  return out;
}

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

function sameOrigin(a, b) {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

/**
 * Prefer shallow section roots over leaf articles.
 * e.g. .../learn/architecture → .../learn when that parent exists in candidates,
 * and prefer top-level siblings like /specification over nested SDK pages.
 */
function liftPathsToSectionRoots(paths, { seedUrl, navCandidates = [], sitemapSample = [] }) {
  const candidateSet = new Set();
  for (const raw of [
    seedUrl,
    ...navCandidates.map((c) => (typeof c === "string" ? c : c?.url)),
    ...sitemapSample,
  ]) {
    const n = normalizeUrl(raw);
    if (n && !isGithubRepoUrl(n)) candidateSet.add(n);
  }

  function bestParent(url) {
    const norm = normalizeUrl(url);
    if (!norm) return null;
    const segs = pathSegments(norm);
    // Walk parents; prefer the shallowest still-useful root (≥1 segment).
    // Stop early when we hit a known candidate.
    let best = null;
    for (let len = segs.length - 1; len >= 1; len -= 1) {
      try {
        const parent = normalizeUrl(
          new URL(`/${segs.slice(0, len).join("/")}`, norm).toString(),
        );
        if (!parent || parent === norm) continue;
        if (candidateSet.has(parent)) {
          best = parent;
          // Prefer shorter parents when they are top-level section roots
          // (docs, specification, reference, examples, api, guide, guides).
          const parentSegs = pathSegments(parent);
          const leaf = (parentSegs[parentSegs.length - 1] || "").toLowerCase();
          if (
            parentSegs.length <= 2 ||
            /^(docs|documentation|specification|spec|reference|api|examples?|guides?|learn)$/i.test(
              leaf,
            )
          ) {
            return parent;
          }
        }
      } catch {
        /* ignore */
      }
    }
    return best;
  }

  const out = [];
  const seen = new Set();
  for (const row of paths) {
    const original = normalizeUrl(row.url);
    if (!original) continue;
    const lifted = bestParent(original) || original;
    if (seen.has(lifted)) continue;
    seen.add(lifted);
    out.push({
      ...row,
      url: lifted,
      label:
        lifted === original
          ? row.label
          : row.label || pathSegments(lifted).slice(-1)[0] || undefined,
    });
  }
  return out;
}

function extractNavCandidates(html, seedUrl) {
  const origin = new URL(seedUrl).origin;
  const hrefRe = /href\s*=\s*["']([^"']+)["']/gi;
  const textHints = [
    "get started",
    "getting started",
    "docs",
    "documentation",
    "guides",
    "guide",
    "api",
    "reference",
    "examples",
    "example",
    "learn",
    "overview",
    "tutorial",
  ];
  const found = new Map();
  let match;
  while ((match = hrefRe.exec(html)) != null) {
    const raw = match[1];
    if (!raw || raw.startsWith("#") || raw.startsWith("mailto:")) continue;
    let abs;
    try {
      abs = new URL(raw, seedUrl).toString();
    } catch {
      continue;
    }
    if (!abs.startsWith(origin)) continue;
    if (isGithubRepoUrl(abs)) continue;
    const norm = normalizeUrl(abs);
    if (!norm) continue;
    const lower = norm.toLowerCase();
    const path = new URL(norm).pathname.toLowerCase();
    const hintHit = textHints.some(
      (h) => path.includes(`/${h.replace(/\s+/g, "-")}`) || path.includes(h.replace(/\s+/g, "")),
    );
    // Keep same-origin doc-ish paths and shallow nav targets.
    const depth = path.split("/").filter(Boolean).length;
    if (hintHit || depth <= 4) {
      found.set(norm, { url: norm, path });
    }
  }
  return [...found.values()].slice(0, 80);
}

function progressLine(done, total, pkg, status, detail) {
  const width = 24;
  const filled = Math.round((done / Math.max(total, 1)) * width);
  const bar = `${"█".repeat(filled)}${"░".repeat(Math.max(0, width - filled))}`;
  const pct = String(Math.round((done / Math.max(total, 1)) * 100)).padStart(3);
  const short = detail ? String(detail).slice(0, 48) : "-";
  return `[${bar}] ${pct}%  ${String(done).padStart(4)}/${total}  ${pkg} → ${status}  ${short}`;
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

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, size + i));
  return out;
}

function usableDocsStatus(status) {
  return status === "verified" || status === "fixed";
}

async function fetchHtmlContext(seedUrl) {
  try {
    const res = await withTimeout(
      fetch(seedUrl, {
        headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
        redirect: "follow",
      }),
      htmlTimeoutMs,
      "html",
    );
    if (!res.ok) {
      return {
        ok: false,
        finalUrl: seedUrl,
        title: "",
        navCandidates: [],
        error: `HTTP ${res.status}`,
      };
    }
    const finalUrl = normalizeUrl(res.url) || seedUrl;
    const html = await res.text();
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim().slice(0, 120) : "";
    return {
      ok: true,
      finalUrl,
      title,
      navCandidates: extractNavCandidates(html.slice(0, 500_000), finalUrl),
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      finalUrl: seedUrl,
      title: "",
      navCandidates: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function fetchSitemapSample(seedUrl) {
  try {
    return await withTimeout(
      (async () => {
        const signals = await probeDiscoverySignals(seedUrl, USER_AGENT);
        let urls = [];
        if (signals.sitemap?.found) {
          urls = (await discoverSitemapUrls([seedUrl], [], USER_AGENT)) || [];
        }
        // Cap hard — huge TanStack sitemaps OOMd verify.
        const sample = urls.slice(0, sitemapSampleMax).map((u) => normalizeUrl(u) || u);
        return {
          sitemapFound: Boolean(signals.sitemap?.found),
          sitemapPageCount: urls.length || signals.sitemap?.pageCount || 0,
          sitemapSample: sample.filter(Boolean),
          error: null,
        };
      })(),
      sitemapTimeoutMs,
      "sitemap",
    );
  } catch (error) {
    return {
      sitemapFound: false,
      sitemapPageCount: 0,
      sitemapSample: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function buildTools({ setSubmitted }) {
  return {
    submit_docs_paths: tool({
      description:
        "Submit docs section roots. Only high-confidence paths. Call once.",
      inputSchema: resultSchema,
      execute: async (input) => {
        const paths = filterConfidentPaths(input.paths || []);
        let status = input.status;
        if (status === "discovered" && paths.length === 0) status = "uncertain";
        setSubmitted({
          status,
          paths,
          confidence: input.confidence,
          reason: String(input.reason || "").slice(0, 500),
        });
        return { ok: true, pathCount: paths.length };
      },
    }),
  };
}

function buildAgentSystemPrompt() {
  return `You get page.snapshot() (site structure) AND a viewport screenshot together.
Use BOTH to decide documentation SECTION ROOTS for the crawler.

SITE-LEVEL primary/header nav = siblings (include those).
Nested sidebar chapters under Docs = children (EXCLUDE — do not list every guide page).
Prefer a shallow docs/guides root + sibling sections (specification, examples, sdk, reference)
over leaf pages like …/learn/architecture or …/develop/build-server.
Prefer omit over a wrong sibling. Each path needs confidence ≥ ${minPathConfidence}.
Call submit_docs_paths exactly once.`;
}

function buildAgentUserContent({ pkg, seedUrl, context }) {
  const snap = context.snapshot;
  const text = `Package: ${pkg}
Seed: ${seedUrl}

=== page.snapshot() structure ===
(${snap?.treeChars || 0} chars${snap?.truncated ? `, truncated from ${snap.originalTreeChars}` : ""}, final=${snap?.finalUrl || "-"})
${snap?.error ? `error: ${snap.error}\n` : ""}${snap?.formattedTree || "(no snapshot)"}

urls in snapshot:
${JSON.stringify(snap?.urlSample || [], null, 2)}

=== page.screenshot() ===
${context.screenshot?.ok ? "Viewport screenshot attached below. Cross-check top nav / section siblings with the tree." : `No screenshot (${context.screenshot?.error || "missing"}). Decide from snapshot only; omit unsure siblings.`}

Submit only high-confidence section roots.`;

  if (context.screenshot?.ok && context.screenshot.buffer) {
    return [
      { type: "text", text },
      {
        type: "image",
        image: context.screenshot.buffer,
        mediaType: "image/png",
      },
    ];
  }
  return text;
}

async function runAgent({ model, pkg, seedUrl, context }) {
  /** @type {any} */
  let submitted = null;
  const tools = buildTools({
    setSubmitted: (value) => {
      submitted = value;
    },
  });

  try {
    const content = buildAgentUserContent({ pkg, seedUrl, context });
    const result = await generateText({
      model,
      tools,
      toolChoice: "auto",
      stopWhen: [stepCountIs(maxSteps), hasToolCall("submit_docs_paths")],
      system: buildAgentSystemPrompt(),
      ...(typeof content === "string"
        ? { prompt: content }
        : { messages: [{ role: "user", content }] }),
    });
    if (!submitted) {
      return {
        status: "failed",
        paths: [],
        confidence: 0,
        reason: `No submit_docs_paths (finishReason=${result.finishReason || "?"})`,
      };
    }
    return submitted;
  } catch (error) {
    return {
      status: "failed",
      paths: [],
      confidence: 0,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

if (singleUrl) {
  // One-off mode against a bare URL — still writes summary JSON.
}

if (!singleUrl && !existsSync(inputPath)) {
  console.error(`Input not found: ${inputPath}`);
  process.exit(1);
}

const { model, modelId, label, stagehandModelConfig } = createAgentModel();
const started = Date.now();

let stagehand = null;
async function getStagehand() {
  if (!useBrowser) return null;
  if (!stagehand) {
    stagehand = createStagehand(stagehandModelConfig);
    await stagehand.init();
  }
  return stagehand;
}

const fullInput = singleUrl
  ? [
      {
        package: packageFilter || "url-target",
        docs: singleUrl,
        docsStatus: "verified",
        apiReferenceUrls: [],
      },
    ]
  : JSON.parse(readFileSync(inputPath, "utf8"));

if (!Array.isArray(fullInput) || fullInput.length === 0) {
  console.error("Input JSON must be a non-empty array.");
  process.exit(1);
}

let entries = fullInput.filter((row) => row?.package || row?.pkg || singleUrl);
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

const eligible = entries.filter((entry) => {
  const docs = normalizeUrl(entry.docs);
  if (!docs || isGithubRepoUrl(docs)) return false;
  if (entry.isRedirect || entry.redirectUncrawlable) return false;
  const status = entry.docsStatus || null;
  if (usableDocsStatus(status)) return true;
  if (includeUncertain && status === "uncertain") return true;
  // One-off / explicit package still allowed if docs URL exists.
  if (packageFilter || singleUrl) return true;
  return false;
});

const skippedNotReady = entries.length - eligible.length;
let work = eligible;
if (limit != null) work = work.slice(0, limit);

const checkpoint = loadCheckpoint();
const results = { ...(checkpoint.results || {}) };
let checkpointChain = Promise.resolve();
function saveCheckpointSafe(state) {
  checkpointChain = checkpointChain.then(() => {
    saveCheckpoint(state);
  });
  return checkpointChain;
}

console.log(`Provider:    ${provider}`);
console.log(`Model:       ${modelId}`);
console.log(`Client:      ${label}`);
console.log(
  `Browser:     ${
    useBrowser
      ? `${stagehandEnv}${headed ? " (headed)" : " (headless)"} · topnav-gate → observe siblings`
      : "off (--no-browser)"
  }`,
);
console.log(`Entries:     ${work.length} to process (${skippedNotReady} skipped — not verified/fixed)`);
console.log(`Concurrency: ${concurrency}`);
console.log(
  `Timeouts:    html ${Math.round(htmlTimeoutMs / 1000)}s · sitemap ${Math.round(sitemapTimeoutMs / 1000)}s · browser ${Math.round(browserTimeoutMs / 1000)}s · sample≤${sitemapSampleMax}`,
);
console.log(`Min path confidence: ${minPathConfidence}`);
console.log(`Snapshot max chars: ${snapshotMaxChars}`);
console.log(`Input:       ${singleUrl ? "(single --url)" : inputPath}`);
console.log(`Output:      ${outPath}`);
console.log(`Resume:      ${resume ? "yes" : "no"}`);
console.log("");

let doneCount = 0;
let progressChain = Promise.resolve();
function logProgress(item) {
  progressChain = progressChain.then(() => {
    doneCount += 1;
    const detail =
      item.row.paths?.[0]?.url ||
      item.row.reason ||
      item.row.docsUrl ||
      "-";
    console.log(
      progressLine(
        doneCount,
        work.length,
        item.pkg,
        item.row.status,
        detail,
      ),
    );
  });
  return progressChain;
}

async function discoverOne(entry) {
  const pkg = entry.package || entry.pkg || "unknown";
  const seedUrl = normalizeUrl(entry.docs);
  if (results[pkg]?.status) {
    return { pkg, skipped: true, row: results[pkg] };
  }
  if (!seedUrl) {
    const row = {
      package: pkg,
      status: "skipped",
      paths: [],
      confidence: 0,
      reason: "No docs URL",
      modelId,
    };
    results[pkg] = row;
    await saveCheckpointSafe({ results });
    return { pkg, skipped: false, row };
  }

  console.log(`[${pkg}] html+sitemap…`);
  const [html, sitemap] = await Promise.all([
    fetchHtmlContext(seedUrl),
    fetchSitemapSample(seedUrl),
  ]);
  console.log(
    `[${pkg}] html=${html.ok ? "ok" : "fail"} nav=${html.navCandidates.length} sitemap=${sitemap.sitemapPageCount} sample=${sitemap.sitemapSample.length}` +
      (html.error ? ` htmlErr=${html.error}` : "") +
      (sitemap.error ? ` sitemapErr=${sitemap.error}` : ""),
  );

  let submitted = null;
  let discoveryMethod = "agent";

  if (useBrowser) {
    console.log(`[${pkg}] top-nav gate (snapshot+screenshot)…`);
    const sh = await getStagehand();
    const nav = await discoverPathsViaBrowser(sh, seedUrl, model);
    if (nav.mode === "seed-only" || nav.isTopNavbar === false) {
      console.log(
        `[${pkg}] topNavbar=no (${nav.layout?.confidence ?? "?"}) ${nav.layout?.reason || nav.error || ""}`.slice(
          0,
          160,
        ),
      );
      submitted = {
        status: "uncertain",
        paths: filterConfidentPaths([
          {
            kind: "guides",
            url: seedUrl,
            label: "docs",
            confidence: minPathConfidence,
          },
        ]),
        confidence: 0.55,
        reason: `Not a top-navbar sibling case: ${nav.layout?.reason || "sidebar/single-tree docs"}. Kept seed only.`,
      };
      discoveryMethod = "seed-only-no-topnav";
    } else {
      console.log(
        `[${pkg}] topNavbar=yes → observe siblings=${nav.siblings?.length || 0}` +
          (nav.observe?.selector
            ? ` sel=${String(nav.observe.selector).slice(0, 64)}`
            : "") +
          (nav.error ? ` err=${nav.error}` : ""),
      );
      if (nav.ok && Array.isArray(nav.siblings)) {
        submitted = siblingsToSubmitted(nav.siblings, seedUrl);
        discoveryMethod = "observe-siblings";
        for (const s of nav.siblings) {
          console.log(`  · ${String(s.seg || "").padEnd(18)} ${s.url}`);
        }
        if (nav.droppedSamePath) {
          console.log(
            `  (dropped ${nav.droppedSamePath} same-path subpage peer(s))`,
          );
        }
      }
    }
  }

  // Only fall back to agent when we believed it was a top-nav case but observe failed.
  if (!submitted && discoveryMethod !== "seed-only-no-topnav") {
    console.log(`[${pkg}] fallback agent (html+sitemap)…`);
    const agentContext = {
      html,
      sitemap,
      snapshot: { ok: false, formattedTree: "", urlSample: [], treeChars: 0 },
      screenshot: { ok: false, buffer: null },
      apiReferenceUrls: entry.apiReferenceUrls || [],
    };
    submitted = await runAgent({
      model,
      pkg,
      seedUrl,
      context: agentContext,
    });
    discoveryMethod = "agent-fallback";
  }

  if (!submitted) {
    submitted = {
      status: "failed",
      paths: [],
      confidence: 0,
      reason: "No observe siblings and agent did not submit paths",
    };
  }

  // On hard failure, keep previous paths rather than wiping good data.
  if (
    submitted.status === "failed" &&
    Array.isArray(entry.paths) &&
    entry.paths.length > 0
  ) {
    const row = {
      package: pkg,
      status: entry.pathsStatus || "uncertain",
      paths: entry.paths,
      confidence: entry.pathsConfidence ?? 0,
      reason: `Kept previous paths; new run failed: ${submitted.reason || "unknown"}`,
      seedUrl,
      modelId,
    };
    results[pkg] = row;
    await saveCheckpointSafe({ results });
    return { pkg, skipped: false, row };
  }

  // Confident paths only (already filtered in tool). Optionally ensure seed docs.
  let paths = Array.isArray(submitted.paths) ? [...submitted.paths] : [];
  if (
    (submitted.status === "discovered" || submitted.status === "uncertain") &&
    paths.length === 0 &&
    seedUrl
  ) {
    paths = [
      {
        kind: "guides",
        url: seedUrl,
        label: "docs",
        confidence: minPathConfidence,
      },
    ];
  }

  // Dedupe + drop github
  const seen = new Set();
  paths = paths.filter((p) => {
    const url = normalizeUrl(p.url);
    if (!url || isGithubRepoUrl(url) || seen.has(url)) return false;
    seen.add(url);
    p.url = url;
    return true;
  });

  // Only lift agent guesses; observe siblings are already section roots.
  if (discoveryMethod !== "observe-siblings") {
    paths = liftPathsToSectionRoots(paths, {
      seedUrl,
      navCandidates: html?.navCandidates || [],
      sitemapSample: sitemap?.sitemapSample || [],
    });
  }
  paths = paths.map((p) => ({
    ...p,
    confidence:
      typeof p.confidence === "number" ? p.confidence : minPathConfidence,
  }));
  paths = filterConfidentPaths(paths);
  // Final guard: never keep same-path subpage clusters as multi-roots.
  if (paths.length >= 2) {
    const dirs = new Set(paths.map((p) => parentDirKey(p.url)));
    if (dirs.size === 1) {
      paths = [
        paths.find((p) => normalizeUrl(p.url) === seedUrl) || paths[0],
      ];
      submitted = {
        ...submitted,
        status: "uncertain",
        reason: `${submitted.reason || ""} (collapsed same-path subpages)`.trim(),
      };
    }
  }

  const status =
    submitted.status === "discovered" && paths.length === 0
      ? "uncertain"
      : submitted.status;

  const row = {
    package: pkg,
    status,
    paths,
    confidence: submitted.confidence ?? 0,
    reason: submitted.reason || "",
    seedUrl,
    modelId,
    discoveryMethod,
    isWeak: false,
    usedScreenshot: false,
  };
  results[pkg] = row;
  await saveCheckpointSafe({ results });
  return { pkg, skipped: false, row };
}

try {
  for (const group of chunk(work, concurrency)) {
    await Promise.all(
      group.map(async (entry) => {
        const item = await discoverOne(entry);
        await logProgress(item);
        return item;
      }),
    );
  }
} finally {
  if (stagehand) {
    try {
      await stagehand.close();
    } catch {
      // ignore
    }
  }
}

await checkpointChain;
await progressChain;
process.stdout.write("\n");

function applyPathsFields(entry, row) {
  const paths = Array.isArray(row.paths) ? row.paths : [];
  return {
    ...entry,
    paths,
    // Convenience for ingest → LedgeIndex startUrls
    startUrls: paths.map((p) => p.url).filter(Boolean),
    pathsStatus: row.status || entry.pathsStatus || null,
    pathsConfidence: row.confidence ?? entry.pathsConfidence ?? null,
    pathsReason: row.reason || entry.pathsReason || null,
    modelId: row.modelId || entry.modelId || modelId,
  };
}

let output;
if (singleUrl) {
  output = work.map((entry) => {
    const pkg = entry.package || entry.pkg;
    return applyPathsFields(entry, results[pkg] || {});
  });
} else if (outPath === inputPath) {
  output = fullInput.map((entry) => {
    const pkg = entry.package || entry.pkg;
    const row = results[pkg];
    if (!row?.status) return entry;
    return applyPathsFields(entry, row);
  });
} else {
  output = work.map((entry) => {
    const pkg = entry.package || entry.pkg;
    return applyPathsFields(entry, results[pkg] || {});
  });
}

writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`);

const counts = {
  discovered: 0,
  uncertain: 0,
  failed: 0,
  skipped: 0,
};
const failures = [];
const uncertain = [];
const usable = [];
for (const row of Object.values(results)) {
  const key = row.status in counts ? row.status : "failed";
  counts[key] += 1;
  if (row.status === "discovered") usable.push(row);
  else if (row.status === "uncertain") uncertain.push(row);
  else if (row.status === "failed" || row.status === "skipped") failures.push(row);
}

const summary = {
  generatedAt: new Date().toISOString(),
  modelId,
  processed: Object.keys(results).length,
  skippedNotReady,
  counts,
  usable: usable.map((r) => ({
    package: r.package,
    paths: r.paths,
    confidence: r.confidence,
  })),
  uncertain: uncertain.map((r) => ({
    package: r.package,
    paths: r.paths,
    reason: r.reason,
  })),
  failed: failures.map((r) => ({
    package: r.package,
    status: r.status,
    reason: r.reason,
  })),
};

mkdirSync(dirname(summaryPath), { recursive: true });
writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);

const elapsedSec = ((Date.now() - started) / 1000).toFixed(1);
console.log("Path discovery status:");
for (const [k, v] of Object.entries(counts)) {
  console.log(`  ${k.padEnd(12)} ${v}`);
}
console.log("");
console.log(`Usable (discovered): ${usable.length}`);
if (uncertain.length) {
  console.log(`Needs review (uncertain): ${uncertain.length}`);
  for (const row of uncertain.slice(0, 15)) {
    console.log(`  - ${row.package}: ${row.reason || "(no reason)"}`);
  }
}
if (failures.length) {
  console.log(`Failed/skipped: ${failures.length}`);
  for (const row of failures.slice(0, 20)) {
    console.log(`  - ${row.package} [${row.status}]: ${row.reason || "(no reason)"}`);
  }
}
console.log("");
console.log(`Done in ${elapsedSec}s`);
console.log(`Wrote ${output.length} → ${outPath}`);
console.log(`Summary → ${summaryPath}`);
console.log("");
console.log(
  "Next: node scripts/sync-typescript-docs-catalog.mjs && node scripts/propose-docs-exclude-patterns.mjs --url \"…\"",
);
