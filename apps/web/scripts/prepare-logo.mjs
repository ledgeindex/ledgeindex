import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareMarketingImage } from "./prepare-marketing-image.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultOutput = path.join(__dirname, "..", "public/images/logo.webp");

const inputPath = process.argv[2];
const outputPath = process.argv[3] ?? defaultOutput;
const maxWidth = process.argv[4] ? Number(process.argv[4]) : 1024;

if (!inputPath) {
  console.error(
    "Usage: node scripts/prepare-logo.mjs <input.png> [output.webp] [maxWidth]",
  );
  process.exit(1);
}

prepareMarketingImage(inputPath, outputPath, maxWidth).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
