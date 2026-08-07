import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareMarketingImage } from "./prepare-marketing-image.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const imagesDir = path.join(__dirname, "..", "public/images");

/**
 * Regenerates marketing section WebPs from source PNGs.
 * Pass a directory of source files, or set LEDGEINDEX_MARKETING_SRC.
 *
 * Expected filenames in the source dir:
 *   hero-cubes.png, platform-hub.png, knowledge-pipeline.png, knowledge-index.png
 */
const srcDir = process.argv[2] ?? process.env.LEDGEINDEX_MARKETING_SRC?.trim();

if (!srcDir) {
  console.error(
    "Usage: node scripts/prepare-section-images.mjs <source-dir>\n" +
      "   or: LEDGEINDEX_MARKETING_SRC=<dir> node scripts/prepare-section-images.mjs",
  );
  process.exit(1);
}

const ASSETS = [
  {
    input: path.join(srcDir, "hero-cubes.png"),
    output: path.join(imagesDir, "hero-cubes.webp"),
    maxWidth: 1024,
  },
  {
    input: path.join(srcDir, "platform-hub.png"),
    output: path.join(imagesDir, "platform-hub.webp"),
    maxWidth: 1024,
  },
  {
    input: path.join(srcDir, "knowledge-pipeline.png"),
    output: path.join(imagesDir, "knowledge-pipeline.webp"),
    maxWidth: 1024,
  },
  {
    input: path.join(srcDir, "knowledge-index.png"),
    output: path.join(imagesDir, "knowledge-index.webp"),
    maxWidth: 1024,
  },
];

async function main() {
  for (const asset of ASSETS) {
    await prepareMarketingImage(asset.input, asset.output, asset.maxWidth);
  }
  console.log("\nAll section images ready.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
