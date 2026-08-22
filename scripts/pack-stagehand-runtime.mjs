#!/usr/bin/env node
/**
 * Build a platform-specific Stagehand + Playwright Chromium runtime archive for
 * first-use download in packaged desktop (keeps the installer under the file-count cap).
 *
 * Usage (from ledgeindex/):
 *   node scripts/pack-stagehand-runtime.mjs
 *   node scripts/pack-stagehand-runtime.mjs --upload
 *
 * Output:
 *   apps/desktop/build/stagehand-runtime/stagehand-v1-{platform}-{arch}.tar.gz
 *
 * Env:
 *   STAGEHAND_RUNTIME_VERSION  (default: 1 — keep in sync with stagehand-runtime.ts)
 *   LEDGEINDEX_STAGEHAND_GCS_BUCKET (default: ledgeindex-runtime)
 */
import { execFileSync, execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ledgeRoot = join(__dirname, "..");

const RUNTIME_VERSION =
  process.env.STAGEHAND_RUNTIME_VERSION?.trim() || "1";
const platform = process.platform;
const arch = process.arch === "arm64" ? "arm64" : "x64";
const archiveName = `stagehand-v${RUNTIME_VERSION}-${platform}-${arch}.tar.gz`;
const outDir = join(ledgeRoot, "apps", "desktop", "build", "stagehand-runtime");
const outFile = join(outDir, archiveName);

const STAGEHAND_VERSION = "^3.7.2";
const PLAYWRIGHT_VERSION = "^1.55.1";

function countFiles(dir) {
  let n = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) n += countFiles(p);
    else n += 1;
  }
  return n;
}

function pruneRuntimeTree(root) {
  const dropDirNames = new Set([
    "test",
    "tests",
    "__tests__",
    ".github",
    "docs",
    "example",
    "examples",
  ]);
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (dropDirNames.has(entry.name)) {
          rmSync(p, { recursive: true, force: true });
          continue;
        }
        walk(p);
        continue;
      }
      if (entry.name.endsWith(".map")) {
        rmSync(p, { force: true });
      }
    }
  };
  walk(root);
}

function run(cmd, args, opts = {}) {
  const isWin = process.platform === "win32";
  const command = isWin && cmd === "npm" ? "npm.cmd" : cmd;
  execFileSync(command, args, {
    stdio: "inherit",
    shell: isWin,
    ...opts,
  });
}

function whichGcloud() {
  try {
    execSync("gcloud --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

console.log(`[pack-stagehand] building ${archiveName}…`);
const work = mkdtempSync(join(tmpdir(), "ledgeindex-stagehand-pack-"));
const runtimeRoot = join(work, "stagehand-runtime");
mkdirSync(runtimeRoot, { recursive: true });

writeFileSync(
  join(runtimeRoot, "package.json"),
  `${JSON.stringify(
    {
      name: "ledgeindex-stagehand-runtime",
      private: true,
      version: "0.0.0",
      dependencies: {
        "@browserbasehq/stagehand": STAGEHAND_VERSION,
        "playwright-core": PLAYWRIGHT_VERSION,
      },
    },
    null,
    2,
  )}\n`,
  "utf8",
);

const browsersPath = join(runtimeRoot, "browsers");
mkdirSync(browsersPath, { recursive: true });

run("npm", ["install", "--omit=dev", "--no-audit", "--no-fund"], {
  cwd: runtimeRoot,
  env: {
    ...process.env,
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
  },
});

run("npx", ["playwright", "install", "chromium"], {
  cwd: runtimeRoot,
  env: {
    ...process.env,
    PLAYWRIGHT_BROWSERS_PATH: browsersPath,
  },
});

writeFileSync(join(runtimeRoot, ".installed"), `${RUNTIME_VERSION}\n`, "utf8");
pruneRuntimeTree(runtimeRoot);

const fileCount = countFiles(runtimeRoot);
console.log(`[pack-stagehand] runtime tree: ${fileCount} files`);

mkdirSync(outDir, { recursive: true });
if (existsSync(outFile)) rmSync(outFile, { force: true });
run("tar", ["-czf", outFile, "-C", work, "stagehand-runtime"]);

const archiveMb = Math.round(statSync(outFile).size / (1024 * 1024));
console.log(`[pack-stagehand] wrote ${outFile} (${archiveMb} MB, ${fileCount} files)`);

rmSync(work, { recursive: true, force: true });

if (process.argv.includes("--upload")) {
  const bucket =
    process.env.LEDGEINDEX_STAGEHAND_GCS_BUCKET?.trim() || "ledgeindex-runtime";
  const object = archiveName;
  const gsUri = `gs://${bucket}/${object}`;
  const publicUrl = `https://storage.googleapis.com/${bucket}/${object}`;

  if (!whichGcloud()) {
    console.error(
      "[pack-stagehand] gcloud CLI not found — archive built locally only.",
    );
    process.exit(1);
  }

  console.log(`[pack-stagehand] uploading to ${gsUri}…`);
  run("gcloud", [
    "storage",
    "cp",
    outFile,
    gsUri,
    "--cache-control=public,max-age=86400",
  ]);
  console.log(`[pack-stagehand] public URL: ${publicUrl}`);
}
