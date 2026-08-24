import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { dataPath } from "../lib/data-dir.js";

const execFileAsync = promisify(execFile);

/** Bump when the on-disk Chromium layout we look for changes. */
export const STAGEHAND_RUNTIME_VERSION = "1";

export function stagehandBrowsersPath(): string {
  return dataPath("stagehand-runtime", "browsers");
}

/** Docker sets PLAYWRIGHT_BROWSERS_PATH at build time; desktop uses user data. */
export function playwrightBrowsersDir(): string {
  const preset = process.env.PLAYWRIGHT_BROWSERS_PATH?.trim();
  if (preset) return preset;
  return stagehandBrowsersPath();
}

export function applyPlaywrightBrowsersEnv(): void {
  process.env.PLAYWRIGHT_BROWSERS_PATH = playwrightBrowsersDir();
}

function sidecarRoot(): string {
  const argv1 = process.argv[1];
  if (argv1) return dirname(argv1);
  return process.cwd();
}

function resolvePlaywrightCoreCli(): string | null {
  const roots = [sidecarRoot(), process.cwd()];
  for (const root of roots) {
    const pkgJson = join(root, "package.json");
    if (!existsSync(pkgJson)) continue;
    try {
      const req = createRequire(pkgJson);
      const resolved = req.resolve("playwright-core/package.json");
      const cli = join(dirname(resolved), "cli.js");
      if (existsSync(cli)) return cli;
    } catch {
      // try next root
    }
    const cli = join(root, "node_modules", "playwright-core", "cli.js");
    if (existsSync(cli)) return cli;
  }
  return null;
}

function chromiumFolderPresent(browsersDir: string): boolean {
  if (!existsSync(browsersDir)) return false;
  return readdirSync(browsersDir).some((name) => name.startsWith("chromium"));
}

export function isStagehandRuntimeInstalled(): boolean {
  applyPlaywrightBrowsersEnv();
  const browsersDir = playwrightBrowsersDir();
  if (!chromiumFolderPresent(browsersDir)) return false;
  try {
    const req = createRequire(join(sidecarRoot(), "package.json"));
    const pw = req("playwright-core") as {
      chromium?: { executablePath?: () => string };
    };
    const path = pw.chromium?.executablePath?.();
    return Boolean(path && existsSync(path));
  } catch {
    return chromiumFolderPresent(browsersDir);
  }
}

let installInFlight: Promise<void> | null = null;

export function isStagehandRuntimeInstalling(): boolean {
  return installInFlight !== null;
}

/** Path to Playwright-managed Chromium for Stagehand's chrome-launcher. */
export async function resolveChromiumExecutable(): Promise<string> {
  applyPlaywrightBrowsersEnv();
  if (!isStagehandRuntimeInstalled()) {
    throw new Error(
      "Browser runtime not installed. Download it from Header nav paths in crawl settings first.",
    );
  }
  try {
    const { chromium } = (await import("playwright-core")) as {
      chromium: { executablePath: () => string };
    };
    const path = chromium.executablePath();
    if (path && existsSync(path)) return path;
  } catch {
    // fall through
  }
  throw new Error(
    "Chromium folder exists but Playwright cannot resolve the executable. Re-download the browser runtime.",
  );
}

async function installChromiumFromPlaywrightCdn(): Promise<void> {
  applyPlaywrightBrowsersEnv();
  const browsersDir = playwrightBrowsersDir();
  mkdirSync(browsersDir, { recursive: true });

  const cli = resolvePlaywrightCoreCli();
  if (!cli) {
    throw new Error(
      "playwright-core is missing from the packaged sidecar, so Chromium cannot be downloaded. Rebuild the desktop app — only the browser is fetched from Playwright’s CDN (~150 MB), not from LedgeIndex.",
    );
  }

  try {
    await execFileAsync(process.execPath, [cli, "install", "chromium"], {
      env: {
        ...process.env,
        PLAYWRIGHT_BROWSERS_PATH: browsersDir,
      },
      windowsHide: true,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Chromium install failed (Playwright CDN, not LedgeIndex). ${detail}`,
    );
  }

  if (!isStagehandRuntimeInstalled()) {
    throw new Error(
      "Playwright finished but Chromium is not in the local browsers folder.",
    );
  }
}

/** First-use Chromium download into LEDGEINDEX_DATA_DIR (Playwright CDN). */
export async function ensureStagehandRuntime(): Promise<void> {
  if (isStagehandRuntimeInstalled()) return;
  if (!installInFlight) {
    installInFlight = installChromiumFromPlaywrightCdn().finally(() => {
      installInFlight = null;
    });
  }
  await installInFlight;
}

export function getStagehandRuntimeStatus(): {
  installed: boolean;
  installing: boolean;
  version: string;
  downloadUrl: string;
} {
  return {
    installed: isStagehandRuntimeInstalled(),
    installing: isStagehandRuntimeInstalling(),
    version: STAGEHAND_RUNTIME_VERSION,
    downloadUrl: "",
  };
}
