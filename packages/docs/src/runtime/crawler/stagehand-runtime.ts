import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { dataPath } from "../lib/data-dir.js";

const execFileAsync = promisify(execFile);

/** Bump when the downloadable runtime layout or package set changes. */
export const STAGEHAND_RUNTIME_VERSION = "1";

const STAGEHAND_PKG = "@browserbasehq/stagehand";

export function stagehandRuntimeRoot(): string {
  return dataPath("stagehand-runtime");
}

export function stagehandBrowsersPath(): string {
  return join(stagehandRuntimeRoot(), "browsers");
}

function installedMarkerPath(): string {
  return join(stagehandRuntimeRoot(), ".installed");
}

function stagehandModulePath(): string {
  return join(
    stagehandRuntimeRoot(),
    "node_modules",
    "@browserbasehq",
    "stagehand",
    "package.json",
  );
}

export function isStagehandRuntimeInstalled(): boolean {
  if (!existsSync(stagehandModulePath())) return false;
  try {
    const marker = readFileSync(installedMarkerPath(), "utf8").trim();
    return marker === STAGEHAND_RUNTIME_VERSION;
  } catch {
    return false;
  }
}

let installInFlight: Promise<void> | null = null;

export function isStagehandRuntimeInstalling(): boolean {
  return installInFlight !== null;
}

export function resolveStagehandRuntimeDownloadUrl(): string {
  const override = process.env.LEDGEINDEX_STAGEHAND_RUNTIME_URL?.trim();
  if (override) return override;
  const platform = process.platform;
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  return `https://storage.googleapis.com/ledgeindex-runtime/stagehand-v${STAGEHAND_RUNTIME_VERSION}-${platform}-${arch}.tar.gz`;
}

export function applyStagehandRuntimeEnv(): void {
  if (!isStagehandRuntimeInstalled()) return;
  process.env.PLAYWRIGHT_BROWSERS_PATH = stagehandBrowsersPath();
}

export function loadStagehandFromRuntimeDir(): {
  Stagehand: new (options: Record<string, unknown>) => unknown;
} {
  applyStagehandRuntimeEnv();
  const req = createRequire(join(stagehandRuntimeRoot(), "package.json"));
  return req(STAGEHAND_PKG) as {
    Stagehand: new (options: Record<string, unknown>) => unknown;
  };
}

async function downloadFile(url: string, destPath: string): Promise<void> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(
      `Failed to download Stagehand runtime (${res.status}) from ${url}`,
    );
  }
  if (!res.body) {
    throw new Error(`Empty download body from ${url}`);
  }
  await pipeline(res.body as unknown as NodeJS.ReadableStream, createWriteStream(destPath));
}

async function extractTarGz(archivePath: string, destParent: string): Promise<void> {
  mkdirSync(destParent, { recursive: true });
  const root = stagehandRuntimeRoot();
  if (existsSync(root)) {
    rmSync(root, { recursive: true, force: true });
  }
  await execFileAsync(
    "tar",
    ["-xzf", archivePath, "-C", destParent],
    { windowsHide: true },
  );
  const extracted = join(destParent, "stagehand-runtime");
  if (!existsSync(extracted)) {
    throw new Error(
      "Stagehand runtime archive is missing a stagehand-runtime/ root folder",
    );
  }
  if (extracted !== root) {
    mkdirSync(dirname(root), { recursive: true });
    renameSync(extracted, root);
  }
}

async function installStagehandRuntimeOnce(): Promise<void> {
  if (isStagehandRuntimeInstalled()) return;

  const url = resolveStagehandRuntimeDownloadUrl();
  const tmpArchive = join(
    tmpdir(),
    `ledgeindex-stagehand-runtime-${process.pid}.tar.gz`,
  );
  const extractParent = join(tmpdir(), `ledgeindex-stagehand-extract-${process.pid}`);

  try {
    mkdirSync(extractParent, { recursive: true });
    await downloadFile(url, tmpArchive);
    await extractTarGz(tmpArchive, extractParent);

    if (!existsSync(stagehandModulePath())) {
      throw new Error(
        "Downloaded Stagehand runtime is incomplete (missing @browserbasehq/stagehand)",
      );
    }

    writeFileSync(installedMarkerPath(), `${STAGEHAND_RUNTIME_VERSION}\n`, "utf8");
    applyStagehandRuntimeEnv();
  } finally {
    try {
      rmSync(tmpArchive, { force: true });
    } catch {
      // ignore
    }
    try {
      rmSync(extractParent, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

/** First-use download into LEDGEINDEX_DATA_DIR/stagehand-runtime (packaged desktop). */
export async function ensureStagehandRuntime(): Promise<void> {
  if (isStagehandRuntimeInstalled()) return;
  if (!installInFlight) {
    installInFlight = installStagehandRuntimeOnce().finally(() => {
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
    downloadUrl: resolveStagehandRuntimeDownloadUrl(),
  };
}
