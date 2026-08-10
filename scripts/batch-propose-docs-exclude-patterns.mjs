#!/usr/bin/env node
/**
 * Batch-run propose-docs-exclude-patterns.mjs for curated Top 50 (or a filter).
 *
 * Writes:
 *   .cache/docs-exclude/<slug>.json
 *   .cache/docs-exclude/<slug>.patterns.json  (also copied as docs-exclude-<slug>.patterns.json)
 * Patches excludePatterns / versions into top-typescript-docs.json as each package finishes.
 *
 * Usage (from ledgeindex/):
 *   node scripts/batch-propose-docs-exclude-patterns.mjs --curated-top
 *   node scripts/batch-propose-docs-exclude-patterns.mjs --curated-top --resume
 *   node scripts/batch-propose-docs-exclude-patterns.mjs --package playwright
 *   node scripts/batch-propose-docs-exclude-patterns.mjs --curated-top --limit 5
 *
 * Env: DEEPSEEK_API_KEY
 */
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
} from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ledgeRoot = resolve(__dirname, "..");

const CURATED_TOP_DOCS_PACKAGES = [
  "typescript",
  "node",
  "bun",
  "deno",
  "react",
  "next",
  "vue",
  "svelte",
  "astro",
  "@angular/core",
  "express",
  "fastify",
  "hono",
  "@nestjs/core",
  "prisma",
  "drizzle-orm",
  "typeorm",
  "kysely",
  "@supabase/supabase-js",
  "graphql",
  "@apollo/client",
  "@trpc/server",
  "axios",
  "tailwindcss",
  "shadcn",
  "@mui/material",
  "lucide-react",
  "zod",
  "valibot",
  "zustand",
  "jotai",
  "@reduxjs/toolkit",
  "react-hook-form",
  "@tanstack/react-query",
  "vite",
  "vitest",
  "esbuild",
  "turbo",
  "storybook",
  "playwright",
  "cypress",
  "jest",
  "eslint",
  "prettier",
  "tsx",
  "lodash",
  "dayjs",
  "@octokit/rest",
  "ai",
  "openai",
];

const args = process.argv.slice(2);
function argValue(flag, fallback = null) {
  const i = args.findIndex((a) => a === flag);
  if (i === -1) return fallback;
  const next = args[i + 1];
  if (!next || next.startsWith("-")) return true;
  return next;
}

const curatedTop = args.includes("--curated-top");
const resume = args.includes("--resume");
const headed = args.includes("--headed");
const packageFilter = String(argValue("--package", "") || "").trim();
const limit = Math.max(0, Number(argValue("--limit", 0)) || 0);
const maxPages = Math.max(30, Number(argValue("--max-pages", 2000)) || 2000);
const inputPath = resolve(
  ledgeRoot,
  String(argValue("--input", "top-typescript-docs.json")),
);
const cacheDir = resolve(ledgeRoot, ".cache/docs-exclude");
const checkpointPath = resolve(
  ledgeRoot,
  ".cache/docs-exclude-checkpoint.json",
);
const proposerPath = resolve(
  ledgeRoot,
  "scripts/propose-docs-exclude-patterns.mjs",
);

mkdirSync(cacheDir, { recursive: true });

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function packageSlug(name) {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[\/\\]+/g, "__")
    .replace(/[^a-z0-9._-]+/g, "-");
}

function normalizeDocsUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    u.hash = "";
    return u.toString().replace(/\/+$/, "");
  } catch {
    return String(url).replace(/\/+$/, "");
  }
}

function loadCheckpoint() {
  if (!resume || !existsSync(checkpointPath)) {
    return { done: {}, failed: {}, skipped: {}, updatedAt: null };
  }
  try {
    return readJson(checkpointPath);
  } catch {
    return { done: {}, failed: {}, skipped: {}, updatedAt: null };
  }
}

function saveCheckpoint(cp) {
  cp.updatedAt = new Date().toISOString();
  writeJson(checkpointPath, cp);
}

function crawlUrlFor(entry) {
  if (entry.redirectUncrawlable) return null;
  return entry.finalDocsUrl || entry.docs || null;
}

function isReady(entry) {
  const status = entry.docsStatus;
  if (status !== "verified" && status !== "fixed" && status !== "uncertain") {
    return false;
  }
  // Prefer verified/fixed; allow uncertain only when we have a crawlable URL
  // (curated Top 50 may still want a pass).
  return Boolean(crawlUrlFor(entry));
}

function runProposer({ url, outPath }) {
  return new Promise((resolvePromise, reject) => {
    const childArgs = [
      proposerPath,
      "--url",
      url,
      "--out",
      outPath,
      "--max-pages",
      String(maxPages > 0 ? maxPages : 2000),
      "--discover-timeout-ms",
      "90000",
      // Default proposer mode is sitemap-only (no HTML crawl / no browser).
    ];
    if (headed) childArgs.push("--headed", "--browser");

    const child = spawn(process.execPath, childArgs, {
      cwd: ledgeRoot,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      stderr += text;
      process.stderr.write(text);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolvePromise({ stdout, stderr });
      else {
        reject(
          new Error(
            `propose-docs-exclude-patterns exited ${code}${
              stderr ? `: ${stderr.slice(-500)}` : ""
            }`,
          ),
        );
      }
    });
  });
}

function patchSourceEntry(sourceEntries, packageName, result) {
  const want = packageName.toLowerCase();
  const entry = sourceEntries.find(
    (row) => String(row.package || row.name || "").toLowerCase() === want,
  );
  if (!entry) return false;
  entry.excludePatterns = Array.isArray(result.excludePatterns)
    ? result.excludePatterns
    : [];
  entry.patternsAreRegex = Boolean(result.patternsAreRegex);
  entry.versions =
    Array.isArray(result.versions) && result.versions.length > 0
      ? result.versions
      : ["latest"];
  if (!entry.versions.includes("latest")) {
    entry.versions = ["latest", ...entry.versions];
  }
  if (
    !entry.selectedVersion ||
    !entry.versions.includes(entry.selectedVersion)
  ) {
    entry.selectedVersion = entry.versions[0];
  }
  entry.excludeNotes = result.notes || null;
  entry.excludeConfidence =
    typeof result.confidence === "number" ? result.confidence : null;
  entry.excludeUpdatedAt = new Date().toISOString();
  return true;
}

const source = readJson(inputPath);
const sourceEntries = Array.isArray(source) ? source : source.entries || [];
const byPkg = new Map(
  sourceEntries.map((row) => [String(row.package || row.name || ""), row]),
);

let queueNames = curatedTop
  ? [...CURATED_TOP_DOCS_PACKAGES]
  : sourceEntries.map((row) => String(row.package || row.name || "")).filter(Boolean);

if (packageFilter) {
  queueNames = queueNames.filter(
    (name) => name.toLowerCase() === packageFilter.toLowerCase(),
  );
}

const queue = [];
for (const name of queueNames) {
  const entry = byPkg.get(name);
  if (!entry) {
    queue.push({ package: name, missing: true });
    continue;
  }
  queue.push(entry);
}

const checkpoint = loadCheckpoint();
let pending = queue.filter((entry) => {
  const name = entry.package || entry.name;
  if (!name) return false;
  if (checkpoint.done[name] || checkpoint.skipped[name]) return false;
  return true;
});

if (limit > 0) pending = pending.slice(0, limit);

console.log(
  JSON.stringify(
    {
      input: inputPath,
      curatedTop,
      queue: queue.length,
      pending: pending.length,
      resume,
      maxPages,
      cacheDir,
    },
    null,
    2,
  ),
);

let ok = 0;
let failed = 0;
let skipped = 0;

for (let i = 0; i < pending.length; i += 1) {
  const entry = pending[i];
  const packageName = entry.package || entry.name;
  const label = `[${i + 1}/${pending.length}] ${packageName}`;

  if (entry.missing) {
    console.log(`${label} — missing from source, skip`);
    checkpoint.skipped[packageName] = {
      reason: "missing",
      at: new Date().toISOString(),
    };
    skipped += 1;
    saveCheckpoint(checkpoint);
    continue;
  }

  if (!isReady(entry)) {
    console.log(
      `${label} — not crawl-ready (${entry.docsStatus || "no-status"}), skip`,
    );
    checkpoint.skipped[packageName] = {
      reason: `not-ready:${entry.docsStatus || "missing"}`,
      at: new Date().toISOString(),
    };
    skipped += 1;
    saveCheckpoint(checkpoint);
    continue;
  }

  const url = crawlUrlFor(entry);
  const slug = packageSlug(packageName);
  const outPath = join(cacheDir, `${slug}.json`);
  const patternsCachePath = join(cacheDir, `${slug}.patterns.json`);
  const patternsRootPath = join(
    ledgeRoot,
    `docs-exclude-${slug}.patterns.json`,
  );

  console.log(`\n${label}`);
  console.log(`  url: ${url}`);

  try {
    await runProposer({ url, outPath });
    if (!existsSync(outPath)) {
      throw new Error(`Missing output: ${outPath}`);
    }
    const result = readJson(outPath);
    const patternsPayload = {
      package: packageName,
      startUrl: normalizeDocsUrl(entry.docs) || normalizeDocsUrl(url) || url,
      crawlUrl: url,
      excludePatterns: result.excludePatterns || [],
      patternsAreRegex: Boolean(result.patternsAreRegex),
      versions:
        Array.isArray(result.versions) && result.versions.length > 0
          ? result.versions
          : ["latest"],
      confidence: result.confidence ?? null,
      notes: result.notes || null,
      keptCount: result.keptCount ?? null,
      droppedCount: result.droppedCount ?? null,
    };
    writeJson(patternsCachePath, patternsPayload);
    writeJson(patternsRootPath, patternsPayload);

    const patched = patchSourceEntry(sourceEntries, packageName, patternsPayload);
    if (Array.isArray(source)) {
      writeJson(inputPath, sourceEntries);
    } else {
      source.entries = sourceEntries;
      writeJson(inputPath, source);
    }

    checkpoint.done[packageName] = {
      at: new Date().toISOString(),
      excludePatterns: patternsPayload.excludePatterns,
      versions: patternsPayload.versions,
      droppedCount: patternsPayload.droppedCount,
      keptCount: patternsPayload.keptCount,
      confidence: patternsPayload.confidence,
      patched,
    };
    delete checkpoint.failed[packageName];
    saveCheckpoint(checkpoint);
    ok += 1;
    console.log(
      `  ✓ excludes=${patternsPayload.excludePatterns.length} dropped=${patternsPayload.droppedCount ?? "?"} kept=${patternsPayload.keptCount ?? "?"}`,
    );
  } catch (err) {
    failed += 1;
    const message = err instanceof Error ? err.message : String(err);
    checkpoint.failed[packageName] = {
      at: new Date().toISOString(),
      error: message.slice(0, 800),
    };
    saveCheckpoint(checkpoint);
    console.error(`  ✗ ${message}`);
  }
}

console.log(
  JSON.stringify(
    {
      ok,
      failed,
      skipped,
      doneTotal: Object.keys(checkpoint.done).length,
      failedTotal: Object.keys(checkpoint.failed).length,
      checkpoint: checkpointPath,
    },
    null,
    2,
  ),
);

if (failed > 0) process.exitCode = 1;
