/**
 * Delete an indexed repo source (vectors + metadata).
 *
 *   node ledgeindex/scripts/delete-repo.mjs stagehand
 */
import { loadScriptEnv } from "./load-env.mjs";

loadScriptEnv();
const { createLedgeIndex } = await import("../packages/sdk/dist/index.js");

const slug = process.argv[2];

if (!slug) {
  console.error("Usage: node scripts/delete-repo.mjs <slug>");
  process.exit(2);
}

const li = await createLedgeIndex({
  dataDir: process.env.LEDGEINDEX_DATA_DIR,
});

const { deleted, sourceId } = await li.deleteSource(slug);

if (deleted) {
  console.log(`Deleted ${slug} (${sourceId}) from ${li.dataDir}`);
} else {
  console.error(`Source not found: ${slug}`);
  process.exit(1);
}
