#!/usr/bin/env node
/**
 * Build (if needed) + upload the CDN widget bundle to GCS.
 *
 * Usage (from ledgeindex/):
 *   node scripts/upload-widget-gcs.mjs
 *   npm run upload:widget -w @ledgeindex/widget
 *
 * Env:
 *   LEDGEINDEX_WIDGET_GCS_BUCKET     (default: ledgeindex-widget)
 *   LEDGEINDEX_WIDGET_GCS_OBJECT     (default: ledgeindex-widget.bundle.js)
 *   LEDGEINDEX_WIDGET_GCS_LOCATION   (default: EU) — used when creating bucket
 *   SKIP_BUILD=1                     skip vite build
 *
 * Requires: gcloud CLI authenticated with permission to create/update the bucket.
 */
import { execFileSync, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ledgeRoot = join(__dirname, "..");
const widgetRoot = join(ledgeRoot, "packages", "widget");
const distFile = join(widgetRoot, "dist", "ledgeindex-widget.bundle.js");
const corsPath = join(widgetRoot, "gcs-cors.json");

const bucket =
  process.env.LEDGEINDEX_WIDGET_GCS_BUCKET?.trim() || "ledgeindex-widget";
const object =
  process.env.LEDGEINDEX_WIDGET_GCS_OBJECT?.trim() ||
  "ledgeindex-widget.bundle.js";
const location =
  process.env.LEDGEINDEX_WIDGET_GCS_LOCATION?.trim() || "EU";
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

function tryRun(cmd, args) {
  try {
    run(cmd, args);
    return true;
  } catch {
    return false;
  }
}

function whichGcloud() {
  try {
    execSync("gcloud --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function bucketExists() {
  return tryRun("gcloud", [
    "storage",
    "buckets",
    "describe",
    `gs://${bucket}`,
  ]);
}

function ensurePublicBucket() {
  if (bucketExists()) {
    console.log(`[upload-widget] bucket gs://${bucket} exists`);
    return;
  }

  console.log(
    `[upload-widget] creating gs://${bucket} (${location}, public read)…`,
  );
  run("gcloud", [
    "storage",
    "buckets",
    "create",
    `gs://${bucket}`,
    `--location=${location}`,
    "--uniform-bucket-level-access",
  ]);

  run("gcloud", [
    "storage",
    "buckets",
    "add-iam-policy-binding",
    `gs://${bucket}`,
    "--member=allUsers",
    "--role=roles/storage.objectViewer",
  ]);
}

function applyCors() {
  console.log(`[upload-widget] applying CORS on gs://${bucket}…`);
  if (
    !tryRun("gcloud", [
      "storage",
      "buckets",
      "update",
      `gs://${bucket}`,
      `--cors-file=${corsPath}`,
    ])
  ) {
    console.warn("[upload-widget] CORS update failed — continuing upload…");
  }
}

function verifyPublicUrl() {
  try {
    execSync(`curl -fsSI "${publicUrl}"`, { stdio: "pipe" });
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

let project = "";
try {
  project = execSync("gcloud config get-value project", {
    encoding: "utf8",
  }).trim();
} catch {
  // ignore
}
console.log(
  `[upload-widget] GCP project: ${project || "(not set — run gcloud config set project …)"}`,
);

ensurePublicBucket();
applyCors();

console.log(`[upload-widget] uploading → ${gsUri}`);
run("gcloud", [
  "storage",
  "cp",
  distFile,
  gsUri,
  "--cache-control=public,max-age=300",
  "--content-type=application/javascript",
]);

const version = process.env.npm_package_version || "0.1.0";
const versioned = `gs://${bucket}/v${version}/ledgeindex-widget.bundle.js`;
console.log(`[upload-widget] uploading versioned → ${versioned}`);
if (
  !tryRun("gcloud", [
    "storage",
    "cp",
    distFile,
    versioned,
    "--cache-control=public,max-age=31536000,immutable",
    "--content-type=application/javascript",
  ])
) {
  console.warn("[upload-widget] versioned upload skipped");
}

if (!verifyPublicUrl()) {
  console.error(`
[upload-widget] upload finished but public URL is not reachable yet:
  ${publicUrl}

Check bucket IAM (allUsers → Storage Object Viewer) and org public access policy.
`);
  process.exit(1);
}

console.log(`
[upload-widget] done

Public URL:
  ${publicUrl}

Embed snippet src:
  ${publicUrl}
`);
