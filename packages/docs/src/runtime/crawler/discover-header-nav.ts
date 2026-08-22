import { generateObject } from "ai";
import { fork } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isMainThread } from "node:worker_threads";
import { z } from "zod";
import {
  getGoogleGenerativeApiKey,
  hasDeepSeekKey,
  hasGoogleGenerativeKey,
  hasOpenAiKey,
} from "../vector/config.js";
import { getModelObject } from "../llm/model-utils.js";
import { normalizeStartUrl } from "../lib/url.js";
import { isLocalHostingDeployment } from "../db/types.js";

export type HeaderNavPath = {
  url: string;
  label: string;
};

export type HeaderNavDiscoveryResult = {
  seed: HeaderNavPath;
  paths: HeaderNavPath[];
  isTopNavbar: boolean;
  reason: string;
};

const DEFAULT_GOOGLE_MODEL = "gemini-3.5-flash-lite";
const DEFAULT_OPENAI_MODEL = "gpt-5.4-mini";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-flash";
const DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1";
const SNAPSHOT_MAX_CHARS = 12_000;
const BROWSER_TIMEOUT_MS = 90_000;
const MARKETING_SEG_RE =
  /^(pricing|login|signin|signup|register|careers|jobs|about|contact|legal|privacy|terms|cookies|status|blog|github|discord|twitter)$/i;

const navLayoutSchema = z.object({
  isTopNavbar: z.boolean(),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});

type StagehandHandle = {
  init: () => Promise<void>;
  close: () => Promise<void>;
  observe: (instruction: string) => Promise<unknown>;
  context: {
    pages: () => Array<StagehandPage>;
    newPage: () => Promise<StagehandPage>;
  };
};

type StagehandPage = {
  goto: (
    url: string,
    options?: { waitUntil?: string; timeout?: number },
  ) => Promise<unknown>;
  waitForTimeout?: (ms: number) => Promise<void>;
  snapshot: () => Promise<{ formattedTree?: string } | undefined>;
  screenshot: (options: {
    type: "png";
    fullPage: boolean;
  }) => Promise<Buffer>;
  evaluate: <T, A>(pageFunction: (arg: A) => T, arg: A) => Promise<T>;
  url: () => string;
};

let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function labelFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1];
    if (!last) return parsed.hostname.replace(/^www\./, "") || "Start";
    return last
      .split(/[-_]/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(" ");
  } catch {
    return url;
  }
}

function pathSegments(url: string): string[] {
  try {
    return new URL(url).pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  } catch {
    return [];
  }
}

function isVersionishSeg(seg: string): boolean {
  return (
    /^v\d+/i.test(seg) ||
    /^\d{4}-\d{2}-\d{2}$/.test(seg) ||
    /^latest$/i.test(seg)
  );
}

function sectionRootKey(url: string): string {
  const segs = pathSegments(url);
  if (segs.length === 0) return "";
  if (isVersionishSeg(segs[0] ?? "") && segs.length >= 2) {
    return `${segs[0]}/${segs[1]}`.toLowerCase();
  }
  return (segs[0] ?? "").toLowerCase();
}

function parentDirKey(url: string): string {
  const segs = pathSegments(url);
  if (segs.length <= 1) return segs.join("/").toLowerCase();
  return segs.slice(0, -1).join("/").toLowerCase();
}

function normalizeUrl(input: string): string | null {
  if (!input) return null;
  try {
    const raw = String(input).includes("://") ? input : `https://${input}`;
    const parsed = new URL(raw);
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "") || parsed.origin;
  } catch {
    return null;
  }
}

function isGithubRepoUrl(input: string): boolean {
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

function isMarketingNavUrl(url: string): boolean {
  const segs = pathSegments(url);
  if (segs.length === 0) return false;
  return (
    MARKETING_SEG_RE.test(segs[0] ?? "") ||
    MARKETING_SEG_RE.test(segs[segs.length - 1] ?? "")
  );
}

type SiblingRow = {
  text: string;
  url: string;
  isMain: boolean;
};

function filterSectionSiblings(siblings: SiblingRow[]): SiblingRow[] {
  const bySection = new Map<string, SiblingRow>();
  for (const row of siblings) {
    const key = sectionRootKey(row.url);
    if (!key) continue;
    const prev = bySection.get(key);
    if (!prev) {
      bySection.set(key, row);
      continue;
    }
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

  const out = [...bySection.values()];
  if (out.length <= 1) return out;
  const dirs = new Set(out.map((row) => parentDirKey(row.url)));
  if (dirs.size === 1) {
    const only = out.find((row) => row.isMain) || out[0];
    return only ? [only] : [];
  }
  return out;
}

export type HeaderNavProviderId = "google" | "openai" | "deepseek";

export type HeaderNavProviderOption = {
  id: HeaderNavProviderId;
  label: string;
  available: boolean;
};

export type HeaderNavProviderCatalog = {
  /** Desktop / self-host can pick any keyed provider. Hosted prod stays on Google. */
  choosable: boolean;
  default: HeaderNavProviderId;
  providers: HeaderNavProviderOption[];
};

const PROVIDER_LABELS: Record<HeaderNavProviderId, string> = {
  google: "Gemini",
  openai: "OpenAI",
  deepseek: "DeepSeek",
};

function keyForProvider(id: HeaderNavProviderId): boolean {
  switch (id) {
    case "google":
      return hasGoogleGenerativeKey();
    case "openai":
      return hasOpenAiKey();
    case "deepseek":
      return hasDeepSeekKey();
  }
}

function envCrawlProvider(): HeaderNavProviderId | null {
  const raw = process.env.LEDGEINDEX_CRAWL_PROVIDER?.trim().toLowerCase();
  if (raw === "google" || raw === "openai" || raw === "deepseek") return raw;
  return null;
}

export function listHeaderNavProviders(): HeaderNavProviderCatalog {
  const choosable = isLocalHostingDeployment();
  const ids: HeaderNavProviderId[] = ["google", "openai", "deepseek"];
  const providers = ids.map((id) => ({
    id,
    label: PROVIDER_LABELS[id],
    available: choosable ? keyForProvider(id) : id === "google" && keyForProvider(id),
  }));
  const fromEnv = envCrawlProvider();
  const firstAvailable =
    providers.find((provider) => provider.available)?.id ?? "google";
  const defaultId =
    !choosable
      ? "google"
      : fromEnv &&
          providers.some((provider) => provider.id === fromEnv && provider.available)
        ? fromEnv
        : firstAvailable;
  return {
    choosable,
    default: defaultId,
    providers,
  };
}

function resolveStagehandModel(preferred?: HeaderNavProviderId): {
  modelName: string;
  apiKey: string;
  languageModelId: string;
  baseURL?: string;
  provider: HeaderNavProviderId;
  supportsVision: boolean;
} {
  const catalog = listHeaderNavProviders();
  if (!catalog.providers.some((provider) => provider.available)) {
    throw new Error(
      catalog.choosable
        ? "Header nav discovery needs a Gemini, OpenAI, or DeepSeek key."
        : "Header nav discovery needs a Google API key.",
    );
  }
  const requested = catalog.choosable ? preferred : "google";
  const chosen =
    requested && catalog.providers.some((p) => p.id === requested && p.available)
      ? requested
      : catalog.default;

  if (chosen === "google") {
    const apiKey = getGoogleGenerativeApiKey();
    if (!apiKey) {
      throw new Error("Google API key missing.");
    }
    return {
      provider: "google",
      modelName: `google/${DEFAULT_GOOGLE_MODEL}`,
      apiKey,
      languageModelId: `google/${DEFAULT_GOOGLE_MODEL}`,
      supportsVision: true,
    };
  }

  if (chosen === "openai") {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) throw new Error("OpenAI API key missing.");
    return {
      provider: "openai",
      modelName: `openai/${DEFAULT_OPENAI_MODEL}`,
      apiKey,
      languageModelId: `openai/${DEFAULT_OPENAI_MODEL}`,
      supportsVision: true,
    };
  }

  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) throw new Error("DeepSeek API key missing.");
  return {
    provider: "deepseek",
    modelName: `openai/${DEFAULT_DEEPSEEK_MODEL}`,
    apiKey,
    languageModelId: `deepseek/${DEFAULT_DEEPSEEK_MODEL}`,
    baseURL: DEEPSEEK_BASE_URL,
    supportsVision: false,
  };
}

async function loadStagehand(): Promise<{
  Stagehand: new (options: Record<string, unknown>) => StagehandHandle;
}> {
  try {
    return (await import("@browserbasehq/stagehand")) as unknown as {
      Stagehand: new (options: Record<string, unknown>) => StagehandHandle;
    };
  } catch {
    // Workspace fallback: catalog scripts already install Stagehand on agents-content.
  }

  const { createRequire } = await import("node:module");
  const { dirname, join, resolve } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const here = dirname(fileURLToPath(import.meta.url));
  const ledgeRoot = resolve(here, "../../../../..");
  const monoRoot = resolve(ledgeRoot, "..");
  const roots = [
    join(monoRoot, "agents-content"),
    ledgeRoot,
    join(ledgeRoot, "hosts", "desktop-server"),
    process.cwd(),
  ];

  for (const root of roots) {
    try {
      const req = createRequire(join(root, "package.json"));
      const mod = req("@browserbasehq/stagehand") as {
        Stagehand: new (options: Record<string, unknown>) => StagehandHandle;
      };
      if (mod?.Stagehand) return mod;
    } catch {
      // try next root
    }
  }

  throw new Error(
    "Stagehand is not installed for this LedgeIndex server. Add @browserbasehq/stagehand to the desktop server, or run from the monorepo where agents-content already has it.",
  );
}

function truncateSnapshot(tree: string): string {
  if (tree.length <= SNAPSHOT_MAX_CHARS) return tree;
  return `${tree.slice(0, SNAPSHOT_MAX_CHARS)}\n…[truncated]`;
}

async function classifyTopNavbar(input: {
  seedUrl: string;
  snapshotText: string;
  screenshot: { ok: boolean; buffer: Buffer | null };
  languageModelId: string;
}): Promise<{ isTopNavbar: boolean; reason: string }> {
  const text = `Seed URL: ${input.seedUrl}

Decide if this docs site has a HORIZONTAL TOP primary navigation bar with multiple SITE SECTION tabs
(example: Documentation | Specification | Extensions | Registry).

isTopNavbar=true ONLY when there is a clear top/header tab row of peer site sections.
isTopNavbar=false for left sidebar / TOC-only sites, a single docs tree, or marketing-only header links.

=== page.snapshot() (capped) ===
${input.snapshotText || "(empty)"}`;

  const content =
    input.screenshot.ok && input.screenshot.buffer
      ? [
          { type: "text" as const, text },
          {
            type: "image" as const,
            image: input.screenshot.buffer,
          },
        ]
      : text;

  try {
    const { object } = await generateObject({
      model: getModelObject(input.languageModelId),
      schema: navLayoutSchema,
      ...(typeof content === "string"
        ? { prompt: content }
        : { messages: [{ role: "user", content }] }),
    });
    return {
      isTopNavbar: Boolean(object.isTopNavbar),
      reason: String(object.reason || ""),
    };
  } catch (error) {
    return {
      isTopNavbar: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

type NavSiblingExtract = {
  ok: boolean;
  error?: string;
  selector?: string;
  siblings?: Array<{
    text: string;
    href: string;
    isMain?: boolean;
  }>;
};

/** Runs inside the browser via page.evaluate — keep self-contained. */
function extractNavSiblingsInBrowser(sel: string): NavSiblingExtract {
  function abs(href: string | null): string | null {
    try {
      const u = new URL(href || "", location.href);
      u.hash = "";
      return u.toString().replace(/\/$/, "") || u.origin;
    } catch {
      return null;
    }
  }
  function firstSeg(url: string): string {
    try {
      return new URL(url).pathname.split("/").filter(Boolean)[0] || "";
    } catch {
      return "";
    }
  }
  function isVersionish(seg: string): boolean {
    return (
      /^v\d+/i.test(seg) ||
      /^\d{4}-\d{2}-\d{2}$/.test(seg) ||
      /^latest$/i.test(seg)
    );
  }
  function sectionKey(url: string): string {
    const segs = new URL(url).pathname
      .replace(/\/+$/, "")
      .split("/")
      .filter(Boolean);
    if (!segs.length) return "";
    if (isVersionish(segs[0] ?? "") && segs.length >= 2) {
      return `${segs[0]}/${segs[1]}`.toLowerCase();
    }
    return (segs[0] ?? "").toLowerCase();
  }

  let el: Element | null = null;
  try {
    if (String(sel).startsWith("xpath=") || String(sel).startsWith("/")) {
      const xp = String(sel).replace(/^xpath=/i, "");
      el = document.evaluate(
        xp,
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null,
      ).singleNodeValue as Element | null;
    } else {
      el = document.querySelector(sel);
    }
  } catch (error) {
    return {
      ok: false,
      error: `selector resolve failed: ${error instanceof Error ? error.message : String(error)}`,
      selector: sel,
    };
  }
  if (!el) return { ok: false, error: "element not found", selector: sel };

  const link =
    el.closest?.("a[href]") ||
    (el.tagName === "A" ? el : el.querySelector?.("a[href]"));
  const target = (link || el) as Element;

  let best: NavSiblingExtract | null = null;
  let node: Element | null = target;
  for (let depth = 0; depth < 8 && node; depth += 1) {
    const parent = node.parentElement;
    if (!parent) break;
    const peers = [...parent.children]
      .map((child) => {
        const a =
          child.tagName === "A"
            ? (child as HTMLAnchorElement)
            : (child.querySelector(":scope > a[href], a[href]") as
                | HTMLAnchorElement
                | null);
        if (!a) return null;
        const href = abs(a.getAttribute("href"));
        if (!href) return null;
        if (a.closest("aside, [data-sidebar], nav[aria-label*='sidebar' i]")) {
          return null;
        }
        return {
          text: (a.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80),
          href,
          isMain:
            child === target ||
            a === target ||
            child.contains?.(target) ||
            false,
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row));

    const sectionCount = new Set(
      peers.map((row) => sectionKey(row.href)).filter(Boolean),
    ).size;
    if (
      !best ||
      sectionCount >
        new Set(
          (best.siblings || [])
            .map((row) => sectionKey(row.href))
            .filter(Boolean),
        ).size ||
      (sectionCount ===
        new Set(
          (best.siblings || [])
            .map((row) => sectionKey(row.href))
            .filter(Boolean),
        ).size &&
        peers.length > (best.siblings?.length ?? 0))
    ) {
      best = {
        ok: peers.length > 0,
        selector: sel,
        siblings: peers,
      };
    }
    if (sectionCount >= 2) break;
    node = parent;
  }

  return best || { ok: false, error: "no parent peers", selector: sel };
}

async function gotoSeedPage(page: StagehandPage, url: string): Promise<void> {
  const timeout = 60_000;
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout });
  } catch {
    await page.goto(url, { waitUntil: "commit", timeout });
  }
}

async function discoverWithStagehand(
  seedUrl: string,
  preferredProvider?: HeaderNavProviderId,
): Promise<HeaderNavDiscoveryResult> {
  const seed = {
    url: normalizeUrl(seedUrl) || normalizeStartUrl(seedUrl),
    label: labelFromUrl(seedUrl),
  };
  const { Stagehand } = await loadStagehand();
  const model = resolveStagehandModel(preferredProvider);
  const env = String(process.env.STAGEHAND_ENV || "LOCAL").toUpperCase();
  const stagehandModel: Record<string, string> = {
    modelName: model.modelName,
    apiKey: model.apiKey,
  };
  if (model.baseURL) stagehandModel.baseURL = model.baseURL;
  const stagehand = new Stagehand(
    env === "BROWSERBASE"
      ? {
          env: "BROWSERBASE",
          apiKey: process.env.BROWSERBASE_API_KEY,
          projectId: process.env.BROWSERBASE_PROJECT_ID,
          model: stagehandModel,
          verbose: 0,
        }
      : {
          env: "LOCAL",
          model: stagehandModel,
          localBrowserLaunchOptions: { headless: true },
          verbose: 0,
        },
  );

  try {
    await stagehand.init();
    const page =
      stagehand.context.pages()[0] || (await stagehand.context.newPage());
    await gotoSeedPage(page, seed.url);
    try {
      await page.waitForTimeout?.(1200);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }

    const snap = await page.snapshot();
    const snapshotText = truncateSnapshot(String(snap?.formattedTree || ""));
    let screenshot: { ok: boolean; buffer: Buffer | null } = {
      ok: false,
      buffer: null,
    };
    try {
      const buffer = await page.screenshot({ type: "png", fullPage: false });
      screenshot = {
        ok: Buffer.isBuffer(buffer) && buffer.length > 0,
        buffer,
      };
    } catch {
      screenshot = { ok: false, buffer: null };
    }

    const layout = await classifyTopNavbar({
      seedUrl: seed.url,
      snapshotText,
      screenshot: model.supportsVision
        ? screenshot
        : { ok: false, buffer: null },
      languageModelId: model.languageModelId,
    });

    if (!layout.isTopNavbar) {
      return {
        seed,
        paths: [],
        isTopNavbar: false,
        reason:
          layout.reason ||
          "No top section navbar — kept the start URL only.",
      };
    }

    const observed = await stagehand.observe(
      "find the active/current primary HEADER/TOP navigation tab for Documentation, Docs, Guide, or Learn — not a sidebar link",
    );
    const first = Array.isArray(observed) ? observed[0] : observed;
    const selector =
      first && typeof first === "object" && "selector" in first
        ? String((first as { selector?: string }).selector || "")
        : "";
    if (!selector) {
      return {
        seed,
        paths: [],
        isTopNavbar: true,
        reason: "Top nav found, but observe() returned no tab selector.",
      };
    }

    const extracted = await page.evaluate(extractNavSiblingsInBrowser, selector);

    if (!extracted?.ok) {
      return {
        seed,
        paths: [],
        isTopNavbar: true,
        reason: extracted?.error || "Could not read header nav peers.",
      };
    }

    const origin = new URL(seed.url).origin;
    const raw = (extracted.siblings || [])
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
          isMain: Boolean(row.isMain),
        };
      })
      .filter((row): row is SiblingRow => Boolean(row));

    const siblings = filterSectionSiblings(raw).filter(
      (row) => normalizeUrl(row.url) !== seed.url,
    );

    return {
      seed,
      paths: siblings.map((row) => ({
        url: row.url,
        label: row.text || labelFromUrl(row.url),
      })),
      isTopNavbar: true,
      reason:
        siblings.length > 0
          ? `Found ${siblings.length} sibling section${siblings.length === 1 ? "" : "s"} in the header nav.`
          : "Top nav found, but no extra section roots besides the start URL.",
    };
  } finally {
    try {
      await stagehand.close();
    } catch {
      // ignore close errors
    }
  }
}

function resolveHeaderNavChildScript(): string {
  return join(
    dirname(fileURLToPath(import.meta.url)),
    "discover-header-nav-child.js",
  );
}

function discoverViaSubprocess(
  seedUrl: string,
  preferredProvider?: HeaderNavProviderId,
): Promise<HeaderNavDiscoveryResult> {
  return new Promise((resolve, reject) => {
    const isElectron = Boolean(process.versions.electron);
    const child = fork(resolveHeaderNavChildScript(), [], {
      env: isElectron
        ? { ...process.env, ELECTRON_RUN_AS_NODE: "1" }
        : (process.env as NodeJS.ProcessEnv),
      execPath: process.execPath,
      execArgv: isElectron ? [] : process.execArgv,
    });
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeAllListeners();
      void child.kill();
      fn();
    };
    const timer = setTimeout(() => {
      finish(() =>
        reject(
          new Error(
            `Header nav discovery timed out after ${Math.round(BROWSER_TIMEOUT_MS / 1000)}s`,
          ),
        ),
      );
    }, BROWSER_TIMEOUT_MS + 10_000);

    child.on(
      "message",
      (msg: {
        ok?: boolean;
        result?: HeaderNavDiscoveryResult;
        error?: string;
      }) => {
        if (msg.ok && msg.result) {
          finish(() => resolve(msg.result!));
          return;
        }
        finish(() =>
          reject(new Error(msg.error || "Header nav discovery failed")),
        );
      },
    );
    child.on("error", (error) => finish(() => reject(error)));
    child.on("exit", (code) => {
      if (!settled && code !== 0) {
        finish(() =>
          reject(
            new Error(`Header nav child exited with code ${code ?? "unknown"}`),
          ),
        );
      }
    });
    child.send({ url: seedUrl, provider: preferredProvider });
  });
}

export async function discoverHeaderNavPathsInternal(
  rawUrl: string,
  preferredProvider?: HeaderNavProviderId,
): Promise<HeaderNavDiscoveryResult> {
  const seedUrl = normalizeStartUrl(rawUrl);
  try {
    new URL(seedUrl);
  } catch {
    throw new Error("Invalid URL");
  }

  const work = discoverWithStagehand(seedUrl, preferredProvider);
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      work,
      new Promise<HeaderNavDiscoveryResult>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new Error(
              `Header nav discovery timed out after ${Math.round(BROWSER_TIMEOUT_MS / 1000)}s`,
            ),
          );
        }, BROWSER_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function discoverHeaderNavPaths(
  rawUrl: string,
  preferredProvider?: HeaderNavProviderId,
): Promise<HeaderNavDiscoveryResult> {
  const seedUrl = normalizeStartUrl(rawUrl);
  try {
    new URL(seedUrl);
  } catch {
    throw new Error("Invalid URL");
  }

  return enqueue(async () => {
    if (!isMainThread) {
      return discoverViaSubprocess(seedUrl, preferredProvider);
    }
    return discoverHeaderNavPathsInternal(seedUrl, preferredProvider);
  });
}
