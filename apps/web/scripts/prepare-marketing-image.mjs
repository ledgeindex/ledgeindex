/**
 * Remove background + trim empty space + export WebP for LedgeIndex marketing assets.
 *
 * Uses frontend/scripts/remove-background-rmbg.mjs (RMBG-1.4), then sharp trim.
 *
 * Run from ledgeindex/:
 *   node scripts/prepare-marketing-image.mjs <input> <output> [maxWidth]
 *   npm run prepare-image:sections
 *
 * Env:
 *   IMAGE_TRIM_PADDING — px padding after trim (default: 20)
 *   IMAGE_TRIM_THRESHOLD — sharp trim threshold 0–255 (default: 12)
 */

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, "..");
const ledgeindexRoot = path.resolve(webRoot, "../..");
const repoRoot = path.resolve(ledgeindexRoot, "..");
const frontendRoot = path.join(repoRoot, "frontend");
const rmbgScript = path.join(frontendRoot, "scripts/remove-background-rmbg.mjs");

const require = createRequire(import.meta.url);
const sharp = require(path.join(frontendRoot, "node_modules/sharp"));

const trimPadding = Number(process.env.IMAGE_TRIM_PADDING ?? process.env.LOGO_TRIM_PADDING ?? "20");
const trimThreshold = Number(process.env.IMAGE_TRIM_THRESHOLD ?? process.env.LOGO_TRIM_THRESHOLD ?? "12");
const webpQuality = Number(process.env.RMBG_WEBP_QUALITY ?? "92");

function runRmbg(input, output, maxWidth) {
  const args = [rmbgScript, input, output, "--max-width", String(maxWidth)];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: frontendRoot,
      stdio: "inherit",
      env: process.env,
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`RMBG script exited with code ${code}`));
    });
  });
}

export async function prepareMarketingImage(inputPath, outputPath, maxWidth = 1024) {
  const resolvedInput = path.resolve(inputPath);
  const resolvedOutput = path.resolve(outputPath);

  try {
    await fs.access(resolvedInput);
  } catch {
    throw new Error(`Input file not found: ${resolvedInput}`);
  }

  await fs.mkdir(path.dirname(resolvedOutput), { recursive: true });

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ledgeindex-image-"));
  const tempRmbg = path.join(tempDir, "rmbg.webp");

  try {
    console.log(`\n── ${path.basename(resolvedOutput)}`);
    console.log(`Input:  ${resolvedInput}`);
    console.log(`Output: ${resolvedOutput}`);
    console.log(`Trim:   threshold=${trimThreshold}, padding=${trimPadding}px`);

    await runRmbg(resolvedInput, tempRmbg, maxWidth);

    const before = await sharp(tempRmbg).metadata();
    console.log(`Before trim: ${before.width}x${before.height}`);

    await sharp(tempRmbg)
      .trim({ threshold: trimThreshold })
      .extend({
        top: trimPadding,
        bottom: trimPadding,
        left: trimPadding,
        right: trimPadding,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .webp({ quality: webpQuality, effort: 4 })
      .toFile(resolvedOutput);

    const after = await sharp(resolvedOutput).metadata();
    const stat = await fs.stat(resolvedOutput);
    console.log(`After trim:  ${after.width}x${after.height}`);
    console.log(`Wrote ${(stat.size / 1024).toFixed(0)} KB`);

    return { width: after.width ?? 0, height: after.height ?? 0 };
  } finally {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Windows may still have handles open — output is already written
    }
  }
}

async function main() {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3];
  const maxWidth = process.argv[4] ? Number(process.argv[4]) : 1024;

  if (!inputPath || !outputPath) {
    console.error("Usage: node scripts/prepare-marketing-image.mjs <input> <output> [maxWidth]");
    process.exit(1);
  }

  await prepareMarketingImage(inputPath, outputPath, maxWidth);
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
