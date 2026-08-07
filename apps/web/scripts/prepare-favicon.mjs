/**
 * Generate Next.js app icons from public/images/logo.webp
 *
 * Run from ledgeindex/:
 *   npm run prepare-image:favicon
 */

import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ledgeindexRoot = path.resolve(__dirname, "..");
const frontendRoot = path.resolve(ledgeindexRoot, "..", "frontend");
const require = createRequire(import.meta.url);
const sharp = require(path.join(frontendRoot, "node_modules/sharp"));

const logoPath = path.join(ledgeindexRoot, "public/images/logo.webp");
const appDir = path.join(ledgeindexRoot, "src/app");

async function writeSquareIcon(size, outputName) {
  const padding = Math.round(size * 0.08);
  const inner = size - padding * 2;

  await sharp(logoPath)
    .resize(inner, inner, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .extend({
      top: padding,
      bottom: padding,
      left: padding,
      right: padding,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toFile(path.join(appDir, outputName));

  console.log(`Wrote ${outputName} (${size}x${size})`);
}

async function main() {
  try {
    await fs.access(logoPath);
  } catch {
    throw new Error(`Logo not found: ${logoPath}`);
  }

  await fs.mkdir(appDir, { recursive: true });

  // Remove default Next.js favicon if present
  const legacyFavicon = path.join(appDir, "favicon.ico");
  try {
    await fs.unlink(legacyFavicon);
    console.log("Removed default favicon.ico");
  } catch {
    // already gone
  }

  await writeSquareIcon(32, "icon.png");
  await writeSquareIcon(180, "apple-icon.png");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
