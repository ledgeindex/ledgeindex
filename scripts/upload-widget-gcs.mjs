#!/usr/bin/env node
/**
 * Build (if needed) + upload the CDN widget bundle to GCS.
 *
 * Usage (from ledgeindex/):
 *   node scripts/upload-widget-gcs.mjs
 *   npm run upload:widget -w @ledgeindex/widget
 *
 * Env:
 *   LEDGEINDEX_WIDGET_GCS_BUCKET  (default: ledgeindex-widget)
 *   LEDGEINDEX_WIDGET_GCS_OBJECT  (default: ledgeindex-widget.bundle.js)
 *   SKIP_BUILD=1                  skip vite build
 *
 * Requires: gcloud CLI authenticated with write access to the bucket.
 */
import { execFileSync, execSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ledgeRoot = join(__dirname, "..");
const widgetRoot = join(ledgeRoot, "packages", "widget");
const distFile = join(widgetRoot, "dist", "ledgeindex-widget.bundle.js");

const bucket =
  process.env.LEDGEINDEX_WIDGET_GCS_BUCKET?.trim() || "ledgeindex-widget";
const object =
  process.env.LEDGEINDEX_WIDGET_GCS_OBJECT?.trim() ||
  "ledgeindex-widget.bundle.js";
const gsUri = `gs://${bucket}/${object}`;
const publicUrl = `https://storage.googleapis.com/${bucket}/${object}`;

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

if (process.env.SKIP_BUILD !== "1") {
  console.log("[upload-widget] building @ledgeindex/widget…");
  run("npm", ["run", "build", "-w", "@ledgeindex/widget"], { cwd: ledgeRoot });
}

if (!existsSync(distFile)) {
  console.error(`[upload-widget] missing ${distFile} — build failed?`);
  process.exit(1);
}

if (!whichGcloud()) {
  console.error(
    "[upload-widget] gcloud CLI not found. Install Google Cloud SDK and run gcloud auth login.",
  );
  process.exit(1);
}

const corsPath = join(widgetRoot, "gcs-cors.json");
if (!existsSync(corsPath)) {
  writeFileSync(
    corsPath,
    `${JSON.stringify(
      [
        {
          origin: ["*"],
          method: ["GET", "HEAD"],
          responseHeader: ["Content-Type", "Cache-Control"],
          maxAgeSeconds: 3600,
        },
      ],
      null,
      2,
    )}\n`,
  );
}

console.log(`[upload-widget] applying CORS on gs://${bucket}…`);
try {
  run("gcloud", [
    "storage",
    "buckets",
    "update",
    `gs://${bucket}`,
    `--cors-file=${corsPath}`,
  ]);
} catch {
  console.warn(
    "[upload-widget] CORS update failed (bucket missing or no permission). Continuing upload…",
  );
}

console.log(`[upload-widget] uploading → ${gsUri}`);
run("gcloud", [
  "storage",
  "cp",
  distFile,
  gsUri,
  "--cache-control=public,max-age=300",
  "--content-type=application/javascript",
]);

// Also publish a versioned copy for cache-busting.
const version = process.env.npm_package_version || "0.1.0";
const versioned = `gs://${bucket}/v${version}/ledgeindex-widget.bundle.js`;
console.log(`[upload-widget] uploading versioned → ${versioned}`);
try {
  run("gcloud", [
    "storage",
    "cp",
    distFile,
    versioned,
    "--cache-control=public,max-age=31536000,immutable",
    "--content-type=application/javascript",
  ]);
} catch {
  console.warn("[upload-widget] versioned upload skipped");
}

console.log(`
[upload-widget] done

Public URL:
  ${publicUrl}

Snippet src=
  ${publicUrl}

Local test (no GCS):
  npm run test:serve -w @ledgeindex/widget
  open http://localhost:3456/test/
`);
